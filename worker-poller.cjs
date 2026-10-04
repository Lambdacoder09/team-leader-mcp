#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';
const DEFAULT_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

function usage() {
  return `Usage:
  node worker-poller.cjs --worker-id <id> --runner <program> [options] [-- <runner args...>]

Options:
  --worker-id <id>       Worker ID used to fetch, claim, and submit tasks.
                         Defaults to WORKER_ID.
  --base-url <url>       Team Leader API base URL (default: WORKER_API_URL or ${DEFAULT_BASE_URL}).
  --interval-ms <number> Poll interval in milliseconds (default: ${DEFAULT_INTERVAL_MS}).
  --runner <program>     Local executable that processes one claimed task at a time.
  --help                 Show this help.

The runner receives the task as JSON on stdin and TASK_ID / WORKER_ID in its
environment. On success it must print JSON to stdout, for example:
  {"summary":"Implemented the task","modifiedFiles":["src/file.js"]}

Runner arguments follow --. The runner is launched directly without a shell.
`;
}

function parseArgs(argv) {
  const options = {
    workerId: process.env.WORKER_ID,
    baseUrl: process.env.WORKER_API_URL || DEFAULT_BASE_URL,
    intervalMs: DEFAULT_INTERVAL_MS,
    runner: process.env.WORKER_RUNNER,
    runnerArgs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      options.runnerArgs = argv.slice(i + 1);
      break;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--worker-id' || arg === '--base-url' || arg === '--interval-ms' || arg === '--runner') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Expected a value after ${arg}.`);
      }
      i += 1;
      if (arg === '--worker-id') options.workerId = value;
      if (arg === '--base-url') options.baseUrl = value;
      if (arg === '--interval-ms') options.intervalMs = Number(value);
      if (arg === '--runner') options.runner = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.help) return options;
  if (!options.workerId) throw new Error('Provide --worker-id or set WORKER_ID.');
  if (!options.runner) throw new Error('Provide --runner or set WORKER_RUNNER.');
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 250) {
    throw new Error('--interval-ms must be an integer of at least 250.');
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(options.baseUrl);
  } catch {
    throw new Error('--base-url must be a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw new Error('--base-url must use HTTP or HTTPS.');
  }
  options.baseUrl = parsedBaseUrl.toString().replace(/\/$/, '');
  return options;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Team server returned invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(data.error || `Team server returned HTTP ${response.status}.`);
  }
  return data;
}

async function getPendingTasks(baseUrl, workerId) {
  const url = new URL('/api/tasks', baseUrl);
  url.searchParams.set('workerId', workerId);
  const result = await requestJson(url);
  if (!Array.isArray(result.tasks)) {
    throw new Error('Team server response did not include a tasks array.');
  }
  return result.tasks.filter((task) =>
    task && task.status === 'pending' && (task.assignedTo === workerId || task.assignedTo === 'all')
  );
}

function runWorker(runner, runnerArgs, task, workerId) {
  return new Promise((resolve, reject) => {
    const child = spawn(runner, runnerArgs, {
      shell: false,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, TASK_ID: String(task.id), WORKER_ID: workerId },
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Runner exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
        return;
      }
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new Error('Runner must print a JSON result to stdout.'));
        return;
      }
      if (!result || typeof result.summary !== 'string' || !result.summary.trim()) {
        reject(new Error('Runner result must include a non-empty summary.'));
        return;
      }
      if (result.modifiedFiles !== undefined && !Array.isArray(result.modifiedFiles)) {
        reject(new Error('Runner result modifiedFiles must be an array.'));
        return;
      }
      resolve({ summary: result.summary, modifiedFiles: result.modifiedFiles || [] });
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(JSON.stringify(task));
  });
}

async function claimTask(baseUrl, taskId, workerId) {
  return requestJson(new URL('/api/tasks/claim', baseUrl), {
    method: 'POST',
    body: JSON.stringify({ taskId, workerId }),
  });
}

async function submitTask(baseUrl, taskId, workerId, result) {
  return requestJson(new URL('/api/tasks/submit', baseUrl), {
    method: 'POST',
    body: JSON.stringify({ taskId, workerId, ...result }),
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(options) {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`[worker-poller] Watching for tasks as ${options.workerId} at ${options.baseUrl}`);
  while (!stopping) {
    try {
      const tasks = await getPendingTasks(options.baseUrl, options.workerId);
      for (const task of tasks) {
        if (stopping) break;
        try {
          await claimTask(options.baseUrl, task.id, options.workerId);
          console.log(`[worker-poller] Claimed ${task.id}: ${task.title || '(untitled)'}`);
          const result = await runWorker(options.runner, options.runnerArgs, task, options.workerId);
          await submitTask(options.baseUrl, task.id, options.workerId, result);
          console.log(`[worker-poller] Submitted ${task.id} for review.`);
        } catch (error) {
          console.error(`[worker-poller] Task ${task.id} failed: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`[worker-poller] Poll failed: ${error.message}`);
    }
    if (!stopping) await sleep(options.intervalMs);
  }
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  console.log('[worker-poller] Stopped.');
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      poll(options).catch((error) => {
        console.error(`[worker-poller] Fatal error: ${error.message}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`[worker-poller] ${error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}

module.exports = { getPendingTasks, parseArgs, poll, runWorker };

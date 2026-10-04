const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');

const PORT = process.env.PORT || 8765;
const HOST = '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, '../../.agents');
const TASKS_FILE = path.join(DATA_DIR, 'team-tasks.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(TASKS_FILE)) {
    const initialState = {
      leader: 'team-leader-antigravity',
      workers: [
        { id: 'worker-chatgpt', name: 'ChatGPT Desktop / Web Worker', status: 'idle', lastActive: new Date().toISOString() },
        { id: 'worker-claude', name: 'Claude Desktop / Cursor Worker', status: 'idle', lastActive: new Date().toISOString() },
        { id: 'worker-codex', name: 'Codex / Auxiliary Worker', status: 'idle', lastActive: new Date().toISOString() },
      ],
      tasks: [],
    };
    fs.writeFileSync(TASKS_FILE, JSON.stringify(initialState, null, 2), 'utf8');
    return initialState;
  }
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {
      leader: 'team-leader-antigravity',
      workers: [],
      tasks: [],
    };
  }
}

function saveStore(state) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(state, null, 2), 'utf8');
}

ensureStore();

function createMcpServer() {
  const mcp = new Server(
    {
      name: 'team-leader-bridge',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_team_dashboard',
          description: 'View the active team board: all tasks categorized by status (pending, in_progress, submitted, approved, rejected) and worker states.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'leader_assign_task',
          description: 'LEADER ONLY (Antigravity): Create a new task specification and assign it to a worker AI agent.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'Unique task key (e.g. TASK-101)' },
              title: { type: 'string', description: 'Brief summary of the task' },
              workerId: { type: 'string', description: 'Target worker ID (e.g. "worker-chatgpt", "worker-claude", or "all")' },
              priority: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Task priority level',
              },
              specification: {
                type: 'string',
                description: 'Detailed technical specification, acceptance criteria, and exact instructions.',
              },
              targetFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Relative paths to the files the worker should inspect or modify.',
              },
            },
            required: ['taskId', 'title', 'workerId', 'specification'],
          },
        },
        {
          name: 'leader_review_task',
          description: 'LEADER ONLY (Antigravity): Review a submitted task. Approve it or reject with required changes.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'ID of the task to review' },
              decision: { type: 'string', enum: ['approved', 'rejected'], description: 'Review verdict' },
              feedback: { type: 'string', description: 'Technical review comments, feedback, or further instructions' },
            },
            required: ['taskId', 'decision', 'feedback'],
          },
        },
        {
          name: 'worker_claim_task',
          description: 'WORKER ONLY: Claim a pending task to mark it as in-progress.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'ID of the task to claim' },
              workerId: { type: 'string', description: 'Your assigned worker ID' },
            },
            required: ['taskId', 'workerId'],
          },
        },
        {
          name: 'worker_submit_task',
          description: 'WORKER ONLY: Submit completed work to the Team Leader (Antigravity) for code review.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: { type: 'string', description: 'ID of the task being submitted' },
              workerId: { type: 'string', description: 'Your assigned worker ID' },
              summary: { type: 'string', description: 'Summary of what changes were made and how acceptance criteria were met' },
              modifiedFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of files that were created or modified',
              },
            },
            required: ['taskId', 'workerId', 'summary'],
          },
        },
        {
          name: 'worker_get_my_tasks',
          description: 'WORKER ONLY: Get all tasks assigned to you or waiting for action.',
          inputSchema: {
            type: 'object',
            properties: {
              workerId: { type: 'string', description: 'Your assigned worker ID (e.g. "worker-chatgpt", "worker-claude")' },
            },
            required: ['workerId'],
          },
        },
      ],
    };
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const state = ensureStore();
    const args = request.params.arguments || {};

    switch (request.params.name) {
      case 'get_team_dashboard': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  leader: state.leader,
                  activeWorkers: state.workers,
                  taskSummary: {
                    total: state.tasks.length,
                    pending: state.tasks.filter((t) => t.status === 'pending').length,
                    inProgress: state.tasks.filter((t) => t.status === 'in_progress').length,
                    submittedForReview: state.tasks.filter((t) => t.status === 'submitted').length,
                    approved: state.tasks.filter((t) => t.status === 'approved').length,
                    rejected: state.tasks.filter((t) => t.status === 'rejected').length,
                  },
                  tasks: state.tasks,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'leader_assign_task': {
        const { taskId, title, workerId, priority = 'medium', specification, targetFiles = [] } = args;
        const existingIndex = state.tasks.findIndex((t) => t.id === taskId);
        const newTask = {
          id: taskId,
          title,
          assignedTo: workerId,
          createdBy: 'team-leader-antigravity',
          priority,
          status: 'pending',
          specification,
          targetFiles,
          createdAt: existingIndex >= 0 ? state.tasks[existingIndex].createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (existingIndex >= 0) {
          state.tasks[existingIndex] = newTask;
        } else {
          state.tasks.push(newTask);
        }
        saveStore(state);

        return {
          content: [
            {
              type: 'text',
              text: `[Leader Antigravity]: Successfully created and assigned task ${taskId} ("${title}") to ${workerId}.`,
            },
          ],
        };
      }

      case 'leader_review_task': {
        const { taskId, decision, feedback } = args;
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task with ID ${taskId} not found.`);
        }

        task.status = decision === 'approved' ? 'approved' : 'rejected';
        task.reviewComments = `[${decision.toUpperCase()} by Leader Antigravity]: ${feedback}`;
        task.updatedAt = new Date().toISOString();
        saveStore(state);

        return {
          content: [
            {
              type: 'text',
              text: `[Leader Antigravity]: Task ${taskId} has been reviewed and marked as ${task.status}. Feedback recorded.`,
            },
          ],
        };
      }

      case 'worker_claim_task': {
        const { taskId, workerId } = args;
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task with ID ${taskId} not found.`);
        }

        task.assignedTo = workerId;
        task.status = 'in_progress';
        task.updatedAt = new Date().toISOString();

        const worker = state.workers.find((w) => w.id === workerId);
        if (worker) {
          worker.status = 'busy';
          worker.lastActive = new Date().toISOString();
        } else {
          state.workers.push({ id: workerId, name: workerId, status: 'busy', lastActive: new Date().toISOString() });
        }
        saveStore(state);

        return {
          content: [
            {
              type: 'text',
              text: `[Worker ${workerId}]: Successfully claimed task ${taskId}. Status changed to in_progress. Specification: ${task.specification}`,
            },
          ],
        };
      }

      case 'worker_submit_task': {
        const { taskId, workerId, summary, modifiedFiles = [] } = args;
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task with ID ${taskId} not found.`);
        }

        task.status = 'submitted';
        task.submission = {
          workerId,
          summary,
          modifiedFiles,
          submittedAt: new Date().toISOString(),
        };
        task.updatedAt = new Date().toISOString();

        const worker = state.workers.find((w) => w.id === workerId);
        if (worker) {
          worker.status = 'idle';
          worker.lastActive = new Date().toISOString();
        }
        saveStore(state);

        return {
          content: [
            {
              type: 'text',
              text: `[Worker ${workerId}]: Submitted task ${taskId} for review by Team Leader (Antigravity). Summary: "${summary}".`,
            },
          ],
        };
      }

      case 'worker_get_my_tasks': {
        const { workerId } = args;
        const myTasks = state.tasks.filter((t) => t.assignedTo === workerId || t.assignedTo === 'all');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  workerId,
                  assignedCount: myTasks.length,
                  tasks: myTasks,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${request.params.name} not found.`);
    }
  });

  return mcp;
}

const app = express();
app.use(cors());
app.use(express.json());

// Track active SSE transports by session ID
const transports = new Map();

// 1. Web dashboard for human monitoring & REST access
app.get('/', (req, res) => {
  const state = ensureStore();
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Antigravity Multi-Agent Network Bridge</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f3f4f6; margin: 0; padding: 24px; }
          .header { border-bottom: 1px solid #1f2937; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
          h1 { margin: 0; font-size: 22px; color: #60a5fa; }
          .badge { background: #1e3a8a; color: #93c5fd; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
          .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 18px; }
          .card h3 { margin-top: 0; font-size: 14px; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.5px; }
          .task { background: #1f2937; border-left: 4px solid #3b82f6; padding: 12px; border-radius: 6px; margin-bottom: 10px; }
          .status { font-weight: bold; text-transform: uppercase; font-size: 11px; padding: 2px 6px; border-radius: 4px; display: inline-block; }
          .status-pending { background: #fef3c7; color: #92400e; }
          .status-in_progress { background: #e0e7ff; color: #3730a3; }
          .status-submitted { background: #fef08a; color: #854d0e; }
          .status-approved { background: #dcfce7; color: #166534; }
          .status-rejected { background: #fee2e2; color: #991b1b; }
          pre { background: #030712; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Team Leader: Antigravity</h1>
            <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 13px;">Network Bridge Active on <code>http://192.168.31.219:${PORT}</code></p>
          </div>
          <span class="badge">ONLINE (SSE + REST)</span>
        </div>

        <div class="grid">
          <div class="card">
            <h3>Registered Workers</h3>
            ${state.workers.map(w => `<div><strong>${w.name}</strong> (${w.id}) &mdash; <span style="color: ${w.status === 'busy' ? '#f59e0b' : '#10b981'}">${w.status}</span></div>`).join('')}
          </div>
          <div class="card">
            <h3>MCP Endpoints</h3>
            <div>SSE Endpoint: <code>http://192.168.31.219:${PORT}/sse</code></div>
            <div>Message Post: <code>http://192.168.31.219:${PORT}/message</code></div>
            <div>REST Tasks: <code>http://192.168.31.219:${PORT}/api/tasks</code></div>
          </div>
        </div>

        <h2>Active Tasks Board</h2>
        <div>
          ${state.tasks.length === 0 ? '<p style="color: #6b7280;">No active tasks. Leader can assign tasks using leader_assign_task.</p>' : ''}
          ${state.tasks.map(t => `
            <div class="task">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong>${t.id}: ${t.title}</strong>
                <span class="status status-${t.status}">${t.status}</span>
              </div>
              <div style="font-size: 13px; color: #d1d5db; margin-bottom: 6px;">${t.specification}</div>
              <div style="font-size: 12px; color: #9ca3af;">Assigned To: <strong>${t.assignedTo}</strong> | Priority: <strong>${t.priority}</strong></div>
              ${t.reviewComments ? `<div style="margin-top: 6px; font-size: 12px; color: #60a5fa;">${t.reviewComments}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </body>
    </html>
  `);
});

// 2. Direct REST API for web-based or script-based workers (non-MCP agents)
app.get('/api/tasks', (req, res) => {
  const state = ensureStore();
  const workerId = req.query.workerId;
  if (workerId) {
    const filtered = state.tasks.filter(t => t.assignedTo === workerId || t.assignedTo === 'all');
    return res.json({ workerId, tasks: filtered });
  }
  res.json(state);
});

app.post('/api/tasks/claim', (req, res) => {
  const { taskId, workerId } = req.body;
  const state = ensureStore();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.assignedTo = workerId;
  task.status = 'in_progress';
  task.updatedAt = new Date().toISOString();
  saveStore(state);
  res.json({ success: true, task });
});

app.post('/api/tasks/submit', (req, res) => {
  const { taskId, workerId, summary, modifiedFiles = [] } = req.body;
  const state = ensureStore();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.status = 'submitted';
  task.submission = { workerId, summary, modifiedFiles, submittedAt: new Date().toISOString() };
  task.updatedAt = new Date().toISOString();
  saveStore(state);
  res.json({ success: true, task });
});

// 3. MCP SSE Transport endpoints
app.get('/sse', async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport('/message', res);
  transports.set(transport.sessionId, { transport, server: mcpServer });

  req.on('close', () => {
    transports.delete(transport.sessionId);
  });

  await mcpServer.connect(transport);
});

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = transports.get(sessionId);
  if (!session) {
    return res.status(404).send('Session not found');
  }
  await session.transport.handlePostMessage(req, res);
});

app.listen(PORT, HOST, () => {
  console.log(`[Team Leader Bridge] Network server running on http://${HOST}:${PORT}`);
  console.log(`[Team Leader Bridge] LAN Endpoint: http://192.168.31.219:${PORT}/sse`);
  console.log(`[Team Leader Bridge] Dashboard: http://192.168.31.219:${PORT}`);
});

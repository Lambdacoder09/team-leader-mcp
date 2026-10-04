import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';

// Location of team task database file
const DATA_DIR = path.resolve(__dirname, '../../.agents');
const TASKS_FILE = path.join(DATA_DIR, 'team-tasks.json');

export interface TeamTask {
  id: string;
  title: string;
  assignedTo: string; // e.g. "worker-chatgpt", "worker-1", or "unassigned"
  createdBy: string;  // e.g. "team-leader-antigravity"
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected';
  specification: string;
  targetFiles?: string[];
  submission?: {
    workerId: string;
    summary: string;
    modifiedFiles: string[];
    submittedAt: string;
  };
  reviewComments?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamState {
  leader: string;
  workers: Array<{ id: string; name: string; status: 'idle' | 'busy'; lastActive: string }>;
  tasks: TeamTask[];
}

function ensureStore(): TeamState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(TASKS_FILE)) {
    const initialState: TeamState = {
      leader: 'team-leader-antigravity',
      workers: [
        { id: 'worker-chatgpt', name: 'ChatGPT Desktop Worker', status: 'idle', lastActive: new Date().toISOString() },
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

function saveStore(state: TeamState): void {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(state, null, 2), 'utf8');
}

const server = new Server(
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

// Define tool schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
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
            workerId: { type: 'string', description: 'Target worker ID (e.g. "worker-chatgpt" or "all")' },
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
        description: 'WORKER ONLY (e.g. ChatGPT Desktop): Claim a pending task to mark it as in-progress.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'ID of the task to claim' },
            workerId: { type: 'string', description: 'Your assigned worker ID (e.g. "worker-chatgpt")' },
          },
          required: ['taskId', 'workerId'],
        },
      },
      {
        name: 'worker_submit_task',
        description: 'WORKER ONLY (e.g. ChatGPT Desktop): Submit completed work to the Team Leader (Antigravity) for code review.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'ID of the task being submitted' },
            workerId: { type: 'string', description: 'Your assigned worker ID' },
            summary: { type: 'string', description: 'Summary of what code changes were made and how acceptance criteria were met' },
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
        description: 'WORKER ONLY (e.g. ChatGPT Desktop): Get all tasks assigned to you or waiting for action.',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string', description: 'Your assigned worker ID (e.g. "worker-chatgpt")' },
          },
          required: ['workerId'],
        },
      },
    ],
  };
});

// Execute tool requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const state = ensureStore();
  const args = (request.params.arguments || {}) as any;

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
      const newTask: TeamTask = {
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
      task.reviewComments = `[${decision.toUpperCase()} by Leader]: ${feedback}`;
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Team Leader & Workers Bridge server running on stdio');
}

main().catch((err) => {
  console.error('Fatal MCP Server error:', err);
  process.exit(1);
});

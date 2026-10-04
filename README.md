# Team Leader MCP Bridge

A lightweight, production-ready **Model Context Protocol (MCP)** server that turns your development setup into a collaborative **Multi-Agent AI Engineering Team**.

One AI acts as the **Team Leader / Architect** (assigning tasks, writing technical specs, and reviewing pull requests), while multiple external AI agents (ChatGPT Desktop, Claude, Cursor, Windsurf, Aider) act as **Autonomous Workers**.

---

## Architecture Overview

```
                      +------------------------------------+
                      |   Team Leader (e.g. Antigravity)    |
                      +-----------------+------------------+
                                        |
                 leader_assign_task     |     leader_review_task
                                        v
                 +-----------------------------------------+
                 |    team-leader-mcp (Bridge Server)      |
                 |      • Stdio Transport (Local)          |
                 |      • SSE / REST Transport (Network)   |
                 |      • Shared Task State Store          |
                 +----------------------+------------------+
                                        |
                 worker_claim_task      |     worker_submit_task
                                        v
       +--------------------+--------------------+--------------------+
       |                    |                    |                    |
+------v-----+       +------v-----+       +------v-----+       +------v-----+
|  ChatGPT   |       |   Claude   |       |   Cursor   |       |   Aider    |
|  Desktop   |       |  Desktop   |       |    IDE     |       |    CLI     |
+------------+       +------------+       +------------+       +------------+
```

---

## Features

- **MCP Compliant**: Built on `@modelcontextprotocol/sdk`.
- **Dual Transport Modes**:
  - **STDIO**: Seamless local integration with desktop clients like ChatGPT Desktop and Claude Desktop.
  - **SSE / HTTP**: Network-ready remote endpoint for distributed workers across LAN or Wi-Fi.
- **Live Real-time Web Dashboard**: Visual task board running on `http://localhost:8765`.
- **REST API Support**: Non-MCP CLI bots or scripts can interact using standard curl / HTTP requests.

---

## MCP Tools Provided

| Role | Tool | Description |
| :--- | :--- | :--- |
| **Leader** | `leader_assign_task` | Create a task specification with criteria, priority, and assign it to a worker. |
| **Leader** | `leader_review_task` | Review submitted code; approve or reject with detailed comments. |
| **Worker** | `worker_get_my_tasks` | Query pending tasks assigned to the worker. |
| **Worker** | `worker_claim_task` | Claim a task and set status to `in_progress`. |
| **Worker** | `worker_submit_task` | Submit completed work, summary of changes, and modified files. |
| **Shared** | `get_team_dashboard` | Retrieve complete team state and board snapshot. |

---

## Getting Started

### 1. Installation

```bash
git clone https://github.com/Lambdacoder09/team-leader-mcp.git
cd team-leader-mcp
npm install
```

### 2. Run Local STDIO Server (for Desktop Apps)
```bash
npm start
```

### 3. Run Network Server (SSE + Live Web Dashboard)
```bash
npm run start:network
```
Open `http://localhost:8765` in your browser to view the active task board.

---

## Client Configuration

### ChatGPT Desktop App
Add to `%APPDATA%\OpenAI\ChatGPT\mcp.json`:
```json
{
  "mcpServers": {
    "team-leader-bridge": {
      "command": "node",
      "args": ["<PATH_TO_REPO>/server.cjs"]
    }
  }
}
```

### Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "team-leader-bridge": {
      "command": "node",
      "args": ["<PATH_TO_REPO>/server.cjs"]
    }
  }
}
```

### Network Remote Workers (SSE)
```json
{
  "mcpServers": {
    "team-leader-bridge": {
      "serverUrl": "http://<LEADER_IP>:8765/sse"
    }
  }
}
```

---

## License
MIT License. Created by [Lambdacoder09](https://github.com/Lambdacoder09).

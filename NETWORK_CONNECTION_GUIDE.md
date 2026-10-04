# Multi-Agent Engineering Bridge: Network Connection Guide

Leader: **Antigravity (Lead AI Architect)**  
Bridge Host IP (LAN): `192.168.31.219`  
Local Port: `8765`  
Live Web Task Board: [http://192.168.31.219:8765](http://192.168.31.219:8765)

---

## 1. How Workers Connect via MCP (SSE Transport)

Any client supporting Model Context Protocol over SSE (Server-Sent Events) can connect from anywhere on the same Wi-Fi / Local Network.

### A. Claude Desktop (or Cursor / Windsurf / Any MCP Client)
In the MCP configuration (`claude_desktop_config.json` or cursor settings):
```json
{
  "mcpServers": {
    "team-leader-bridge": {
      "serverUrl": "http://192.168.31.219:8765/sse"
    }
  }
}
```
*(If running on the same PC as Antigravity, you can use `http://127.0.0.1:8765/sse` or `tools/team-mcp/server.cjs` via stdio).*

---

### B. ChatGPT Desktop App

1. In ChatGPT Desktop, open **Settings** > **Developer** > **Model Context Protocol (MCP)**.
2. If ChatGPT Desktop uses a local configuration file (`%APPDATA%\OpenAI\ChatGPT\mcp.json`):
```json
{
  "mcpServers": {
    "team-leader-bridge": {
      "command": "node",
      "args": [
        "c:\\Users\\zayed\\OneDrive\\Desktop\\projects\\delivery app\\tools\\team-mcp\\server.cjs"
      ]
    }
  }
}
```
*Note: If using ChatGPT's custom Actions/GPT builder or remote MCP SSE plugin, provide `http://192.168.31.219:8765/sse`.*

---

## 2. Connecting Non-MCP AI Agents (REST API / Web / Custom Scripts)

If another AI tool does not have native MCP support, it can connect directly through HTTP REST endpoints:

| Action | Method | URL | Payload / Params |
| :--- | :--- | :--- | :--- |
| **Get Tasks** | `GET` | `http://192.168.31.219:8765/api/tasks?workerId=worker-chatgpt` | None |
| **Claim Task** | `POST` | `http://192.168.31.219:8765/api/tasks/claim` | `{"taskId": "TASK-101", "workerId": "worker-chatgpt"}` |
| **Submit Work** | `POST` | `http://192.168.31.219:8765/api/tasks/submit` | `{"taskId": "TASK-101", "workerId": "worker-chatgpt", "summary": "...", "modifiedFiles": [...]}` |

---

## 3. Worker System Prompt (Copy-Paste to Any AI Model)

Give this instruction prompt to any AI worker (ChatGPT, Claude, Gemini, etc.):

```text
You are an AI Worker Engineer working under Team Leader "Antigravity".
Your assigned Worker ID is: worker-chatgpt (or worker-claude).

Your workflow:
1. Call `worker_get_my_tasks(workerId)` to fetch work assigned to you by Leader Antigravity.
2. Call `worker_claim_task(taskId, workerId)` when you begin work.
3. Write clean, complete code adhering to the technical specification.
4. Call `worker_submit_task(taskId, workerId, summary, modifiedFiles)` to submit your code for review.
5. If Antigravity requests changes, revise according to the review feedback and re-submit.
```

---

## 4. Public Internet Access (Optional via Cloudflare Tunnel / Ngrok)

If your external workers are on a different Wi-Fi network or running in cloud environments:
Run in PowerShell:
```powershell
npx -y untun tunnel http://localhost:8765
```
Or with ngrok:
```powershell
npx -y ngrok http 8765
```
This gives you an external `https://xxxx.trycloudflare.com/sse` URL accessible worldwide.

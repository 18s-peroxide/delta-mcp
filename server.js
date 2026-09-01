import express from "express";
import OpenAI from "openai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://delta-mcp-controller.render.com",
    "X-Title": "Delta Roblox MCP Controller",
  }
});

let pendingCommands = [];
let commandResults = {};
let lastPollTime = 0;
let clientInfo = { connected: false, username: "Not Connected", gameName: "Waiting...", iconUrl: "" };

const mcpServer = new Server({
  name: "delta-roblox-mcp",
  version: "3.1.0",
}, {
  capabilities: { tools: {} }
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_luau",
        description: "Executes raw Luau script inside Delta on iOS",
        inputSchema: {
          type: "object",
          properties: { code: { type: "string", description: "Luau code to run" } },
          required: ["code"]
        }
      },
      {
        name: "get_workspace",
        description: "Dumps workspace hierarchy and children from Delta",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  const cmdId = "cmd_" + Date.now();

  pendingCommands.push({ id: cmdId, action: toolName, payload: args });

  let attempts = 0;
  while (!commandResults[cmdId] && attempts < 30) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  const result = commandResults[cmdId] || { status: "timeout", output: "Execution timed out on iOS device" };
  delete commandResults[cmdId];

  return { content: [{ type: "text", text: typeof result.output === 'string' ? result.output : JSON.stringify(result.output) }] };
});

let transport;
app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await mcpServer.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) await transport.handlePostMessage(req, res);
  else res.status(400).send("No SSE connection");
});

app.post("/delta/poll", (req, res) => {
  lastPollTime = Date.now();
  const { username, gameName, iconUrl } = req.body || {};
  if (username) {
    clientInfo = { connected: true, username, gameName: gameName || "Unknown Game", iconUrl: iconUrl || "" };
  }
  res.json(pendingCommands);
  pendingCommands = [];
});

app.post("/delta/result", (req, res) => {
  const { id, status, output } = req.body;
  commandResults[id] = { status, output };
  res.json({ success: true });
});

app.get('/status-check', (req, res) => {
  const connected = (Date.now() - lastPollTime) < 8000;
  if (!connected) clientInfo.connected = false;
  res.json({ ...clientInfo, connected });
});

// Full UI Dashboard Layout
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delta AI Controller | Advanced MCP Hub</title>
  <style>
    :root {
      --bg: #0b0b0e;
      --panel: #141419;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --text: #f4f4f5;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .dashboard { width: 100%; max-width: 850px; background: var(--panel); border: 1px solid var(--border); border-radius: 20px; padding: 32px; box-shadow: 0 25px 50px rgba(0,0,0,0.6); display: grid; grid-template-columns: 1fr; gap: 24px; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    
    /* Telemetry Card */
    .telemetry-card { background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 16px; }
    .game-icon { width: 56px; height: 56px; border-radius: 10px; background: #222; object-fit: cover; border: 1px solid var(--border); }
    .telemetry-info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .telemetry-row { display: flex; justify-content: space-between; align-items: center; }
    .game-title { font-size: 16px; font-weight: 600; color: var(--text); }
    .player-name { font-size: 13px; color: var(--text-muted); }
    .status-badge { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
    .dot.connected { background: var(--success); box-shadow: 0 0 8px var(--success); }

    /* Workspace & Controls */
    .workspace { display: grid; grid-template-columns: 1fr; gap: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    textarea { width: 100%; height: 120px; background: rgba(0,0,0,0.4); color: var(--text); border: 1px solid var(--border); padding: 14px; border-radius: 12px; font-size: 14px; resize: none; outline: none; transition: border-color 0.2s; }
    textarea:focus { border-color: var(--accent); }
    
    .action-bar { display: flex; gap: 12px; }
    select { flex: 2; background: rgba(0,0,0,0.4); color: var(--text); border: 1px solid var(--border); padding: 0 14px; border-radius: 12px; font-size: 14px; outline: none; cursor: pointer; }
    button { flex: 1; background: var(--accent); color: #fff; border: none; padding: 14px; font-weight: 600; border-radius: 12px; cursor: pointer; transition: background 0.2s, transform 0.1s; font-size: 14px; }
    button:hover { background: var(--accent-hover); }
    button:active { transform: scale(0.98); }

    /* Output Console */
    .console-box { background: rgba(0,0,0,0.5); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    pre { color: #34d399; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5; overflow-x: auto; max-height: 250px; }
  </style>
</head>
<body>
  <div class="dashboard">
    <header>
      <h1>Delta AI Controller Hub</h1>
      <div class="status-badge">
        <div id="dot" class="dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
    </header>

    <!-- Roblox Telemetry Status Box -->
    <div class="telemetry-card">
      <img id="game-icon" class="game-icon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23333' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z'/%3E%3C/svg%3E" alt="Game Icon">
      <div class="telemetry-info">
        <div class="telemetry-row">
          <span id="game-name" class="game-title">Waiting for game session...</span>
        </div>
        <div class="telemetry-row">
          <span id="player-name" class="player-name">Player: --</span>
        </div>
      </div>
    </div>

    <!-- Main Workspace -->
    <div class="workspace">
      <div>
        <label for="prompt">AI Command Prompt</label>
        <textarea id="prompt" placeholder="Ask AI to manipulate workspace, run scripts, or get status..."></textarea>
      </div>

      <div class="action-bar">
        <select id="model-select">
          <optgroup label="✨ Free Models">
            <option value="deepseek/deepseek-r1:free">[FREE] DeepSeek R1</option>
            <option value="google/gemini-2.5-flash">[FREE] Gemini 2.5 Flash</option>
            <option value="meta-llama/llama-3.3-70b-instruct:free">[FREE] Llama 3.3 70B</option>
            <option value="google/gemini-flash-1.5">[FREE] Gemini Flash 1.5</option>
          </optgroup>
          <optgroup label="⚡ Paid Models">
            <option value="anthropic/claude-3.5-sonnet">[PAID] Claude 3.5 Sonnet</option>
            <option value="openai/gpt-4o">[PAID] OpenAI GPT-4o</option>
            <option value="deepseek/deepseek-chat">[PAID] DeepSeek V3</option>
            <option value="mistralai/mistral-large">[PAID] Mistral Large</option>
          </optgroup>
        </select>
        <button onclick="sendAICommand()">Execute Task</button>
      </div>

      <div class="console-box">
        <label>Execution Output & Telemetry Logs</label>
        <pre id="output">System initialized. Awaiting commands...</pre>
      </div>
    </div>
  </div>

  <script>
    async function sendAICommand() {
      const promptText = document.getElementById('prompt').value;
      const model = document.getElementById('model-select').value;
      const outputEl = document.getElementById('output');
      
      if (!promptText.trim()) return;
      outputEl.innerText = "Dispatching command to OpenRouter model...";
      
      try {
        const res = await fetch('/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText, model })
        });
        const data = await res.json();
        outputEl.innerText = data.output || JSON.stringify(data, null, 2);
      } catch (err) {
        outputEl.innerText = "Error: " + err;
      }
    }

    setInterval(async () => {
      try {
        const res = await fetch('/status-check');
        const data = await res.json();
        const dot = document.getElementById('dot');
        const text = document.getElementById('status-text');
        
        if (data.connected) {
          dot.classList.add('connected');
          text.innerText = "Delta Connected";
          document.getElementById('game-name').innerText = data.gameName;
          document.getElementById('player-name').innerText = "Player: " + data.username;
          if (data.iconUrl) document.getElementById('game-icon').src = data.iconUrl;
        } else {
          dot.classList.remove('connected');
          text.innerText = "Waiting for Delta...";
        }
      } catch(e) {}
    }, 2000);
  </script>
</body>
</html>`);
});

app.post('/ai-chat', async (req, res) => {
  const { prompt, model } = req.body;
  const selectedModel = model || "google/gemini-2.5-flash";

  try {
    const completion = await openrouter.chat.completions.create({
      model: selectedModel,
      messages: [
        {
          role: "system",
          content: "You are an expert Roblox Luau automation assistant. Format your executable script output strictly inside standard markdown blocks using triple backticks with 'luau' or 'lua'."
        },
        { role: "user", content: prompt }
      ]
    });

    const aiText = completion.choices[0].message.content;
    const match = aiText.match(/```(?:luau|lua)?([\s\S]*?)```/);
    const codeToRun = match ? match[1].trim() : `print([[${aiText.replace(/"/g, '\\"')}]])`;

    const cmdId = "cmd_" + Date.now();
    pendingCommands.push({ id: cmdId, action: "execute_luau", payload: { code: codeToRun } });

    let attempts = 0;
    while (!commandResults[cmdId] && attempts < 30) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    const result = commandResults[cmdId] || { status: "timeout", output: "Execution timed out on iOS device" };
    delete commandResults[cmdId];

    res.json({ aiResponse: aiText, output: result.output });
  } catch (err) {
    console.error("OpenRouter Route Error:", err);
    res.status(500).json({ output: "OpenRouter API Error: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OpenRouter MCP Server running on port ${PORT}`));

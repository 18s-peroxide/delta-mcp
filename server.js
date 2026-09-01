import express from "express";
import OpenAI from "openai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());

// Initialize OpenRouter (OpenAI-compatible client)
const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://delta-mcp-controller.render.com",
    "X-Title": "Delta Roblox MCP Controller",
  }
});

let pendingCommands = [];
let commandResults = {};
let lastPollTime = 0;

const mcpServer = new Server({
  name: "delta-roblox-mcp",
  version: "3.0.0",
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
      },
      {
        name: "get_script_source",
        description: "Decompiles a LocalScript or ModuleScript by path to read its code",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Instance path e.g. game.Players.LocalPlayer.PlayerScripts.Script" } },
          required: ["path"]
        }
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

app.get("/delta/poll", (req, res) => {
  lastPollTime = Date.now();
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
  res.json({ connected, lastSeen: lastPollTime });
});

// Sleek, modern glassmorphism UI
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delta AI Controller | MCP Hub</title>
  <style>
    :root {
      --bg: #09090b;
      --card-bg: rgba(24, 24, 27, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --success: #10b981;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .container { width: 100%; max-width: 650px; background: var(--card-bg); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: 16px; padding: 28px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 600; letter-spacing: -0.5px; }
    .status-badge { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; background: rgba(255,255,255,0.03); padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); transition: background 0.3s; }
    .dot.connected { background: var(--success); box-shadow: 0 0 10px var(--success); }
    label { display: block; font-size: 13px; font-weight: 500; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    textarea { width: 100%; height: 110px; background: rgba(0,0,0,0.3); color: var(--text); border: 1px solid var(--border); padding: 14px; border-radius: 10px; font-size: 14px; resize: none; outline: none; transition: border-color 0.2s; }
    textarea:focus { border-color: var(--accent); }
    .controls { display: flex; gap: 12px; margin-top: 14px; }
    select { background: rgba(0,0,0,0.3); color: var(--text); border: 1px solid var(--border); padding: 0 14px; border-radius: 10px; font-size: 14px; outline: none; cursor: pointer; }
    button { flex: 1; background: var(--accent); color: #fff; border: none; padding: 14px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: background 0.2s, transform 0.1s; font-size: 14px; }
    button:hover { background: var(--accent-hover); }
    button:active { transform: scale(0.98); }
    .output-container { margin-top: 24px; }
    pre { background: rgba(0,0,0,0.4); color: #34d399; padding: 16px; border-radius: 10px; overflow-x: auto; max-height: 300px; border: 1px solid var(--border); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Delta AI Controller</h2>
      <div class="status-badge">
        <div id="dot" class="dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
    </div>
    
    <div>
      <label for="prompt">Command Prompt</label>
      <textarea id="prompt" placeholder="e.g. Read workspace hierarchy or make my walkspeed 100..."></textarea>
      <div class="controls">
        <select id="model-select">
          <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
          <option value="deepseek/deepseek-r1:free">DeepSeek R1 (Free)</option>
        </select>
        <button onclick="sendAICommand()">Execute via MCP</button>
      </div>
    </div>

    <div class="output-container">
      <label>Execution Output</label>
      <pre id="output">System ready for commands...</pre>
    </div>
  </div>

  <script>
    async function sendAICommand() {
      const promptText = document.getElementById('prompt').value;
      const model = document.getElementById('model-select').value;
      const outputEl = document.getElementById('output');
      
      if (!promptText.trim()) return;
      
      outputEl.innerText = "Processing request through OpenRouter...";
      
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
          text.innerText = "Delta iOS Online";
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
          content: "You are an expert Roblox Luau automation assistant. The user wants to run scripts or control game elements via Delta on iOS. If they want to run code, format your executable code strictly inside standard markdown blocks using triple backticks with 'luau' or 'lua'."
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

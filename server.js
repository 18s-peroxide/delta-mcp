import express from "express";
import OpenAI from "openai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: apiKey,
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
  version: "3.3.0",
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

// Fetch OpenRouter Models & map brand/LobeHub metadata
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    const data = await response.json();
    
    if (!data.data) return res.json([]);

    const models = data.data.map(m => {
      const promptPrice = parseFloat(m.pricing?.prompt || "0");
      const completionPrice = parseFloat(m.pricing?.completion || "0");
      const isFree = promptPrice === 0 && completionPrice === 0;
      
      const parts = m.id.split('/');
      const brandSlug = parts.length > 1 ? parts[0].toLowerCase() : 'openai';
      
      // LobeHub Icon Mapping
      let iconUrl = `https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static/icons/${brandSlug}.svg`;

      return {
        id: m.id,
        name: m.name || m.id,
        brand: brandSlug.toUpperCase(),
        isFree,
        iconUrl
      };
    });

    res.json(models);
  } catch (err) {
    console.error("Model fetch error:", err);
    res.status(500).json({ error: "Failed to load model catalog" });
  }
});

// Full UI Dashboard Layout
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delta AI Controller | MCP Command Hub</title>
  <style>
    :root {
      --bg: #09090b;
      --panel: #121216;
      --panel-hover: #1a1a22;
      --border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --success: #10b981;
      --warning: #f59e0b;
      --free-bg: rgba(16, 185, 129, 0.12);
      --free-text: #34d399;
      --paid-bg: rgba(59, 130, 246, 0.12);
      --paid-text: #60a5fa;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 24px; }
    
    .app-container { width: 100%; max-width: 1000px; background: var(--panel); border: 1px solid var(--border); border-radius: 24px; padding: 36px; box-shadow: 0 30px 60px rgba(0,0,0,0.7); display: flex; flex-direction: column; gap: 24px; }
    
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    .logo-area h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; display: flex; align-items: center; gap: 10px; }
    .logo-area span { font-size: 12px; background: rgba(99,102,241,0.15); color: #818cf8; padding: 3px 8px; border-radius: 6px; font-weight: 500; }

    .status-badge { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
    .dot.connected { background: var(--success); box-shadow: 0 0 10px var(--success); }

    .telemetry-card { background: rgba(0,0,0,0.35); border: 1px solid var(--border); border-radius: 14px; padding: 18px; display: flex; align-items: center; gap: 18px; }
    .game-icon { width: 60px; height: 60px; border-radius: 12px; background: #1a1a22; object-fit: cover; border: 1px solid var(--border); }
    .telemetry-info { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .game-title { font-size: 17px; font-weight: 600; color: var(--text); }
    .player-name { font-size: 13px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }

    .workspace-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
    label { display: block; font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
    
    .control-row { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; align-items: center; }
    @media(max-width: 768px) { .control-row { grid-template-columns: 1fr; } }

    /* Custom Dropdown Styling */
    .custom-dropdown { position: relative; width: 100%; user-select: none; }
    .dropdown-select-btn { width: 100%; background: rgba(0,0,0,0.5); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; color: var(--text); display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: 14px; transition: border-color 0.2s; }
    .dropdown-select-btn:hover { border-color: rgba(255,255,255,0.2); }
    .selected-value { display: flex; align-items: center; gap: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .selected-value img { width: 20px; height: 20px; object-fit: contain; }

    .dropdown-panel { position: absolute; top: calc(100% + 6px); left: 0; width: 100%; background: #16161b; border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 20px 40px rgba(0,0,0,0.8); z-index: 100; display: none; flex-direction: column; max-height: 320px; overflow: hidden; }
    .dropdown-panel.open { display: flex; }
    
    .dropdown-search-box { padding: 12px; border-bottom: 1px solid var(--border); background: #121216; }
    .dropdown-search-box input { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text); font-size: 13px; outline: none; }
    .dropdown-search-box input:focus { border-color: var(--accent); }

    .dropdown-options-list { overflow-y: auto; max-height: 240px; padding: 6px; }
    .brand-group-title { font-size: 10px; font-weight: 700; color: var(--text-muted); padding: 8px 10px 4px 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    
    .dropdown-option { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
    .dropdown-option:hover { background: var(--panel-hover); }
    .opt-left { display: flex; align-items: center; gap: 10px; overflow: hidden; }
    .opt-left img { width: 18px; height: 18px; object-fit: contain; flex-shrink: 0; }
    .opt-name { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    .badge { font-size: 10px; font-weight: 700; padding: 3px 7px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
    .badge.free { background: var(--free-bg); color: var(--free-text); }
    .badge.paid { background: var(--paid-bg); color: var(--paid-text); }

    textarea { width: 100%; height: 130px; background: rgba(0,0,0,0.5); color: var(--text); border: 1px solid var(--border); padding: 16px; border-radius: 14px; font-size: 14px; resize: none; outline: none; transition: border-color 0.2s; line-height: 1.5; }
    textarea:focus { border-color: var(--accent); }

    button.execute-btn { background: var(--accent); color: #fff; border: none; padding: 14px; font-weight: 600; border-radius: 14px; cursor: pointer; transition: background 0.2s, transform 0.1s; font-size: 14px; width: 100%; }
    button.execute-btn:hover { background: var(--accent-hover); }
    button.execute-btn:active { transform: scale(0.99); }

    .console-box { background: rgba(0,0,0,0.6); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    pre { color: #34d399; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 1.6; overflow-x: auto; max-height: 260px; }
  </style>
</head>
<body>
  <div class="app-container">
    <header>
      <div class="logo-area">
        <h1>Delta AI Hub <span>MCP v3.3</span></h1>
      </div>
      <div class="status-badge">
        <div id="dot" class="dot"></div>
        <span id="status-text">Connecting...</span>
      </div>
    </header>

    <div class="telemetry-card">
      <img id="game-icon" class="game-icon" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23333' d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z'/%3E%3C/svg%3E" alt="Game Icon">
      <div class="telemetry-info">
        <span id="game-name" class="game-title">Waiting for session...</span>
        <span id="player-name" class="player-name">Player: --</span>
      </div>
    </div>

    <div class="workspace-grid">
      <div>
        <label for="prompt">AI Task Prompt</label>
        <textarea id="prompt" placeholder="Ask AI to write auto-collectors, inspect workspace, or manipulate game state..."></textarea>
      </div>

      <div class="control-row">
        <div>
          <label>Select AI Model</label>
          <div class="custom-dropdown" id="model-dropdown">
            <div class="dropdown-select-btn" onclick="toggleDropdown()">
              <div class="selected-value" id="selected-display">
                <span>Loading complete catalog...</span>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="dropdown-panel" id="dropdown-panel">
              <div class="dropdown-search-box">
                <input type="text" id="model-search" placeholder="Search models or brands..." oninput="filterModels(this.value)">
              </div>
              <div class="dropdown-options-list" id="options-list"></div>
            </div>
          </div>
        </div>
        <div>
          <label>&nbsp;</label>
          <button class="execute-btn" onclick="sendAICommand()">Execute Task</button>
        </div>
      </div>

      <div class="console-box">
        <label>Execution Output & Telemetry Logs</label>
        <pre id="output">System initialized. Awaiting commands...</pre>
      </div>
    </div>
  </div>

  <script>
    let allModelsData = [];
    let selectedModelId = "google/gemini-2.5-flash";

    async function fetchModelsCatalog() {
      try {
        const res = await fetch('/api/models');
        allModelsData = await res.json();
        renderDropdownOptions(allModelsData);
        
        // Default selection handler
        const defaultModel = allModelsData.find(m => m.id === selectedModelId) || allModelsData[0];
        if (defaultModel) {
          setSelectedModel(defaultModel);
        }
      } catch (e) {
        document.getElementById('selected-display').innerHTML = '<span>Failed to load models</span>';
      }
    }

    function renderDropdownOptions(models) {
      const listEl = document.getElementById('options-list');
      listEl.innerHTML = '';

      // Group models by Brand
      const grouped = {};
      models.forEach(m => {
        if (!grouped[m.brand]) grouped[m.brand] = [];
        grouped[m.brand].push(m);
      });

      for (const [brand, groupModels] of Object.entries(grouped)) {
        const groupTitle = document.createElement('div');
        groupTitle.className = 'brand-group-title';
        groupTitle.textContent = brand;
        listEl.appendChild(groupTitle);

        groupModels.forEach(m => {
          const opt = document.createElement('div');
          opt.className = 'dropdown-option';
          opt.onclick = () => { setSelectedModel(m); toggleDropdown(); };
          
          opt.innerHTML = \`
            <div class="opt-left">
              <img src="\${m.iconUrl}" onerror="this.src='https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static/icons/openai.svg'" alt="">
              <span class="opt-name" title="\${m.id}">\${m.name}</span>
            </div>
            <span class="badge \${m.isFree ? 'free' : 'paid'}">\${m.isFree ? 'Free' : 'Paid'}</span>
          \`;
          listEl.appendChild(opt);
        });
      }
    }

    function setSelectedModel(m) {
      selectedModelId = m.id;
      document.getElementById('selected-display').innerHTML = \`
        <img src="\${m.iconUrl}" onerror="this.src='https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static/icons/openai.svg'" alt="">
        <span>\${m.name}</span>
      \`;
    }

    function toggleDropdown() {
      const panel = document.getElementById('dropdown-panel');
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        document.getElementById('model-search').focus();
      }
    }

    function filterModels(query) {
      const q = query.toLowerCase();
      const filtered = allModelsData.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q));
      renderDropdownOptions(filtered);
    }

    // Close dropdown on outside click
    window.onclick = function(event) {
      if (!event.target.closest('#model-dropdown')) {
        document.getElementById('dropdown-panel').classList.remove('open');
      }
    }

    fetchModelsCatalog();

    async function sendAICommand() {
      const promptText = document.getElementById('prompt').value;
      const outputEl = document.getElementById('output');
      
      if (!promptText.trim()) return;
      outputEl.innerText = "Dispatching context-aware prompt to OpenRouter model...";
      
      try {
        const res = await fetch('/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText, model: selectedModelId })
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
    const contextPrompt = `You are an expert Roblox Luau automation assistant controlling Delta on iOS.
CURRENT LIVE TELEMETRY CONTEXT:
- Connected Player Username: ${clientInfo.username}
- Current Game Name: ${clientInfo.gameName}
- Connection Status: ${clientInfo.connected ? "Active" : "Disconnected"}

The user wants you to perform this task: "${prompt}"
Format your executable script output strictly inside standard markdown blocks using triple backticks with 'luau' or 'lua'.`;

    const completion = await openrouter.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: "system", content: contextPrompt },
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
app.listen(PORT, () => console.log(`Delta MCP Server running on port ${PORT}`));

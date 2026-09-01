import express from "express";
import { GoogleGenAI } from "@google/genai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const app = express();
app.use(express.json());

// Explicitly pass the API key to prevent ADC lookup errors
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let pendingCommands = [];
let commandResults = {};
let lastPollTime = 0;

const mcpServer = new Server({
  name: "delta-roblox-mcp",
  version: "2.2.7",
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

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delta Gemini MCP Controller</title>
  <style>
    body { background: #121212; color: #fff; font-family: sans-serif; padding: 15px; margin: 0; }
    h2 { color: #4285F4; text-align: center; }
    textarea { width: 100%; height: 90px; background: #1e1e1e; color: #fff; border: 1px solid #333; padding: 10px; border-radius: 5px; box-sizing: border-box; font-size: 15px; }
    button { width: 100%; background: #4285F4; color: #fff; border: none; padding: 12px; font-weight: bold; border-radius: 5px; margin-top: 10px; font-size: 16px; }
    pre { background: #1e1e1e; padding: 10px; border-radius: 5px; overflow-x: auto; max-height: 280px; border: 1px solid #333; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Delta AI Controller (Gemini MCP)</h2>
  <p>Status: <span id="status" style="color:yellow;">Checking connection...</span></p>
  <label>Ask Gemini to control your game or read scripts:</label>
  <textarea id="prompt" placeholder="e.g. Read the script at game.StarterPlayer.StarterPlayerScripts.ClientScript or make my walkspeed 100"></textarea>
  <button onclick="sendAICommand()">Send to Gemini MCP</button>
  <h3>Execution Output:</h3>
  <pre id="output">Ready...</pre>

  <script>
    async function sendAICommand() {
      const promptText = document.getElementById('prompt').value;
      document.getElementById('output').innerText = "Gemini is processing your request via MCP...";
      
      try {
        const res = await fetch('/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText })
        });
        const data = await res.json();
        document.getElementById('output').innerText = data.output || JSON.stringify(data);
      } catch (err) {
        document.getElementById('output').innerText = "Error: " + err;
      }
    }

    setInterval(async () => {
      try {
        const res = await fetch('/status-check');
        const data = await res.json();
        document.getElementById('status').innerText = data.connected ? "Connected to Delta iOS" : "Waiting for Delta Client...";
        document.getElementById('status').style.color = data.connected ? "#00ffcc" : "yellow";
      } catch(e) {}
    }, 2000);
  </script>
</body>
</html>`);
});

app.post('/ai-chat', async (req, res) => {
  const { prompt } = req.body;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `You are an expert Roblox Luau assistant. The user wants you to perform this task in their game: "${prompt}".
If they want to execute code, format your Luau execution code inside standard markdown blocks using triple backticks followed by luau.`,
    });

    const aiText = response.text;
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
    console.error("AI Chat Route Error:", err);
    res.status(500).json({ output: "Gemini API Error: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Gemini MCP Server running on port ${PORT}`));

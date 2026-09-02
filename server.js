import express from "express";
import OpenAI from "openai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const app = express();

app.use(express.json({ limit: "1mb" }));

// ============================================================
// CONFIG
// ============================================================

const apiKey =
  process.env.OPENROUTER_API_KEY ||
  process.env.OPENAI_API_KEY;

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://delta-mcp-controller.render.com",
    "X-Title": "Delta Roblox MCP Controller"
  }
});

// ============================================================
// STATE
// ============================================================

let pendingCommands = [];
let commandResults = {};

let lastPollTime = 0;

const CONNECTION_TIMEOUT = 8000;

let clientInfo = {
  connected: false,
  username: "",
  gameName: "",
  iconUrl: ""
};

// ============================================================
// LIVE CLIENT STATE
// ============================================================

function isClientConnected() {
  return (
    lastPollTime > 0 &&
    Date.now() - lastPollTime < CONNECTION_TIMEOUT
  );
}

function getLiveClientInfo() {
  if (!isClientConnected()) {
    return {
      connected: false,
      username: "",
      gameName: "",
      iconUrl: ""
    };
  }

  return {
    connected: true,
    username: clientInfo.username || "",
    gameName: clientInfo.gameName || "",
    iconUrl: clientInfo.iconUrl || ""
  };
}

function clearDisconnectedClient() {
  clientInfo = {
    connected: false,
    username: "",
    gameName: "",
    iconUrl: ""
  };
}

// ============================================================
// MCP SERVER
// ============================================================

const mcpServer = new Server(
  {
    name: "delta-roblox-mcp",
    version: "3.6.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

mcpServer.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    return {
      tools: [
        {
          name: "execute_luau",
          description:
            "Executes raw Luau script inside Delta on iOS",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "Luau code to run"
              }
            },
            required: ["code"]
          }
        },

        {
          name: "get_workspace",
          description:
            "Dumps workspace hierarchy and children from Delta",
          inputSchema: {
            type: "object",
            properties: {}
          }
        }
      ]
    };
  }
);

mcpServer.setRequestHandler(
  CallToolRequestSchema,
  async request => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};

    const cmdId = "cmd_" + Date.now();

    pendingCommands.push({
      id: cmdId,
      action: toolName,
      payload: args
    });

    let attempts = 0;

    while (
      !commandResults[cmdId] &&
      attempts < 30
    ) {
      await new Promise(resolve =>
        setTimeout(resolve, 500)
      );

      attempts++;
    }

    const result =
      commandResults[cmdId] || {
        status: "timeout",
        output:
          "Execution timed out on iOS device"
      };

    delete commandResults[cmdId];

    return {
      content: [
        {
          type: "text",
          text:
            typeof result.output === "string"
              ? result.output
              : JSON.stringify(result.output)
        }
      ]
    };
  }
);

// ============================================================
// MCP SSE
// ============================================================

let transport;

app.get("/sse", async (req, res) => {
  try {
    transport = new SSEServerTransport(
      "/messages",
      res
    );

    await mcpServer.connect(transport);
  } catch (err) {
    console.error("SSE connection error:", err);
  }
});

app.post("/messages", async (req, res) => {
  try {
    if (!transport) {
      return res
        .status(400)
        .send("No SSE connection");
    }

    await transport.handlePostMessage(
      req,
      res
    );
  } catch (err) {
    console.error(
      "MCP message error:",
      err
    );

    if (!res.headersSent) {
      res.status(500).send("MCP message error");
    }
  }
});

// ============================================================
// DELTA POLLING BRIDGE
// ============================================================

app.post("/delta/poll", (req, res) => {
  lastPollTime = Date.now();

  const {
    username,
    gameName,
    iconUrl
  } = req.body || {};

  if (username) {
    clientInfo = {
      connected: true,
      username: String(username),
      gameName:
        gameName
          ? String(gameName)
          : "Unknown Game",
      iconUrl:
        iconUrl
          ? String(iconUrl)
          : ""
    };
  }

  const commands = pendingCommands;

  pendingCommands = [];

  res.json(commands);
});

// ============================================================
// DELTA RESULT
// ============================================================

app.post("/delta/result", (req, res) => {
  const {
    id,
    status,
    output
  } = req.body || {};

  if (!id) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Missing command id"
      });
  }

  commandResults[id] = {
    status,
    output:
      output !== undefined
        ? output
        : "Success (No return value)"
  };

  res.json({
    success: true
  });
});

// ============================================================
// STATUS CHECK
// ============================================================

app.get("/status-check", (req, res) => {
  const liveClient = getLiveClientInfo();

  // IMPORTANT:
  // Clear stale telemetry immediately after timeout.
  if (!liveClient.connected) {
    clearDisconnectedClient();
  }

  res.json(
    liveClient
  );
});

// ============================================================
// MODEL ICON SYSTEM
// ============================================================
//
// Uses the current Lobe Icons static SVG CDN rather than the
// old GitHub raw path.
//
// Example:
//
// https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg
//
// Lobe Icons publishes provider/model brand icons as static
// SVG/PNG/WebP assets.
// ============================================================

const LOBE_ICON_BASE =
  "https://unpkg.com/@lobehub/icons-static-svg@latest/icons";

const providerIconMap = {
  openai: "openai",
  anthropic: "claude",
  google: "google",
  gemini: "google",

  "meta-llama": "meta",
  meta: "meta",

  mistralai: "mistral",
  mistral: "mistral",

  deepseek: "deepseek",

  qwen: "qwen",

  cohere: "cohere",

  xai: "xai",

  groq: "groq",

  perplexity: "perplexity",

  microsoft: "microsoft",

  nvidia: "nvidia",

  amazon: "aws",

  ai21: "ai21",

  together: "together",

  fireworks: "fireworks",

  moonshotai: "moonshot",

  "moonshot-ai": "moonshot",

  minimax: "minimax",

  "minimaxai": "minimax",

  zhipuai: "zhipu",

  "z-ai": "zai",

  zai: "zai",

  "01-ai": "01ai",

  baichuan: "baichuan",

  "bytedance": "doubao",
  doubao: "doubao",

  "stepfun": "stepfun",

  "databricks": "databricks",

  ai2: "ai2",

  inflection: "inflection",

  reka: "reka",

  liquid: "liquid",

  nousresearch: "nous",

  nous: "nous",

  openrouter: "openrouter",

  "cloudflare": "cloudflare",

  "sao10k": "sao10k",

  "alpindale": "alpindale",

  "undi95": "undi95",

  "mancer": "mancer",

  "neversleep": "neversleep",

  "thedrummer": "drummer"
};

// Models whose provider is represented by a model-family
// rather than the raw OpenRouter provider namespace.
const modelFamilyIconMap = [
  {
    match: /gemini|gemma/i,
    icon: "google"
  },

  {
    match: /gpt-|o1|o3|o4/i,
    icon: "openai"
  },

  {
    match: /claude/i,
    icon: "claude"
  },

  {
    match: /llama/i,
    icon: "meta"
  },

  {
    match: /mistral|mixtral/i,
    icon: "mistral"
  },

  {
    match: /deepseek/i,
    icon: "deepseek"
  },

  {
    match: /qwen/i,
    icon: "qwen"
  },

  {
    match: /command-r|command-a/i,
    icon: "cohere"
  },

  {
    match: /grok/i,
    icon: "xai"
  },

  {
    match: /nemotron/i,
    icon: "nvidia"
  },

  {
    match: /phi-/i,
    icon: "microsoft"
  },

  {
    match: /minimax/i,
    icon: "minimax"
  },

  {
    match: /glm/i,
    icon: "zhipu"
  }
];

function getIconSlug(model) {
  const id =
    String(model.id || "").toLowerCase();

  const name =
    String(model.name || "").toLowerCase();

  const combined =
    `${id} ${name}`;

  // First use the provider namespace.
  const parts = id.split("/");

  if (parts.length > 1) {
    const provider =
      parts[0]
        .toLowerCase()
        .trim();

    if (providerIconMap[provider]) {
      return providerIconMap[provider];
    }
  }

  // Then use model-family detection.
  for (
    const family of modelFamilyIconMap
  ) {
    if (family.match.test(combined)) {
      return family.icon;
    }
  }

  return null;
}

function getIconUrl(iconSlug) {
  if (!iconSlug) {
    return "";
  }

  return `${LOBE_ICON_BASE}/${encodeURIComponent(
    iconSlug
  )}-color.svg`;
}

// ============================================================
// MODEL CATALOG
// ============================================================

app.get(
  "/api/models",
  async (req, res) => {
    try {
      const response =
        await fetch(
          "https://openrouter.ai/api/v1/models",
          {
            headers: apiKey
              ? {
                  Authorization:
                    `Bearer ${apiKey}`
                }
              : {}
          }
        );

      if (!response.ok) {
        throw new Error(
          `OpenRouter returned HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      if (!Array.isArray(data.data)) {
        return res.json([]);
      }

      const models =
        data.data
          .map(model => {
            const promptPrice =
              parseFloat(
                model.pricing?.prompt || "0"
              );

            const completionPrice =
              parseFloat(
                model.pricing?.completion || "0"
              );

            const isFree =
              promptPrice === 0 &&
              completionPrice === 0;

            const id =
              String(
                model.id || ""
              );

            const parts =
              id.split("/");

            const rawProvider =
              parts.length > 1
                ? parts[0]
                : "";

            const iconSlug =
              getIconSlug(model);

            return {
              id,
              name:
                model.name ||
                id,
              brand:
                rawProvider
                  ? rawProvider
                      .replace(/[-_]/g, " ")
                      .toUpperCase()
                  : "OTHER",
              provider:
                rawProvider,
              isFree,
              iconSlug,
              iconUrl:
                getIconUrl(iconSlug)
            };
          })
          .filter(model => model.id);

      // Put models with known real provider icons first.
      models.sort(
        (a, b) => {
          if (
            Boolean(a.iconUrl) !==
            Boolean(b.iconUrl)
          ) {
            return a.iconUrl
              ? -1
              : 1;
          }

          return a.name.localeCompare(
            b.name
          );
        }
      );

      res.json(models);
    } catch (err) {
      console.error(
        "Model fetch error:",
        err
      );

      res.status(500).json({
        error:
          "Failed to load model catalog"
      });
    }
  }
);

// ============================================================
// DASHBOARD
// ============================================================

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>Delta AI Controller | MCP Command Hub</title>

  <style>
    :root {
      --bg: #050507;
      --sidebar-bg: #0b0b0f;
      --panel: #111116;
      --panel-hover: #181820;

      --border:
        rgba(255, 255, 255, 0.08);

      --accent: #6366f1;
      --accent-hover: #4f46e5;

      --text: #f4f4f5;
      --text-muted: #9494a0;

      --success: #10b981;
      --warning: #f59e0b;

      --free-bg:
        rgba(16, 185, 129, 0.12);

      --free-text: #34d399;

      --paid-bg:
        rgba(59, 130, 246, 0.12);

      --paid-text: #60a5fa;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        sans-serif;
    }

    body {
      background:
        var(--bg);

      color:
        var(--text);

      height: 100vh;
      width: 100vw;

      display: flex;

      overflow: hidden;
    }

    .app-layout {
      display: flex;

      width: 100%;
      height: 100%;
    }

    sidebar {
      width: 440px;

      background:
        var(--sidebar-bg);

      border-right:
        1px solid var(--border);

      display: flex;
      flex-direction: column;

      padding: 24px;

      gap: 20px;

      z-index: 10;

      flex-shrink: 0;

      overflow-y: auto;
    }

    header {
      display: flex;

      justify-content:
        space-between;

      align-items: center;

      border-bottom:
        1px solid var(--border);

      padding-bottom: 16px;
    }

    .logo-area h1 {
      font-size: 18px;

      font-weight: 700;

      letter-spacing: -0.5px;

      display: flex;

      align-items: center;

      gap: 8px;
    }

    .logo-area span {
      font-size: 11px;

      background:
        rgba(99,102,241,0.15);

      color:
        #818cf8;

      padding:
        2px 6px;

      border-radius: 6px;

      font-weight: 500;
    }

    .status-badge {
      display: flex;

      align-items: center;

      gap: 6px;

      font-size: 12px;

      font-weight: 600;

      padding:
        5px 12px;

      border-radius: 20px;

      background:
        rgba(255,255,255,0.03);

      border:
        1px solid var(--border);
    }

    .dot {
      width: 7px;
      height: 7px;

      border-radius: 50%;

      background:
        var(--warning);
    }

    .dot.connected {
      background:
        var(--success);

      box-shadow:
        0 0 8px var(--success);
    }

    .telemetry-card {
      background:
        rgba(0,0,0,0.35);

      border:
        1px solid var(--border);

      border-radius: 12px;

      padding: 14px;

      display: flex;

      align-items: center;

      gap: 14px;

      min-height: 78px;

      transition:
        opacity 0.2s,
        background 0.2s;
    }

    .telemetry-card.disconnected {
      opacity: 0.65;
    }

    .game-icon {
      width: 50px;
      height: 50px;

      border-radius: 10px;

      background:
        #1a1a22;

      object-fit: cover;

      border:
        1px solid var(--border);

      flex-shrink: 0;
    }

    .telemetry-info {
      flex: 1;

      display: flex;

      flex-direction: column;

      gap: 4px;

      overflow: hidden;
    }

    .game-title {
      font-size: 15px;

      font-weight: 600;

      color:
        var(--text);

      white-space: nowrap;

      overflow: hidden;

      text-overflow: ellipsis;
    }

    .player-name {
      font-size: 12px;

      color:
        var(--text-muted);
    }

    .control-group {
      display: flex;

      flex-direction: column;

      gap: 8px;
    }

    label {
      font-size: 11px;

      font-weight: 700;

      color:
        var(--text-muted);

      text-transform:
        uppercase;

      letter-spacing:
        0.8px;
    }

    .custom-dropdown {
      position: relative;

      width: 100%;

      user-select: none;
    }

    .dropdown-select-btn {
      width: 100%;

      background:
        rgba(0,0,0,0.5);

      border:
        1px solid var(--border);

      border-radius: 12px;

      padding:
        12px 14px;

      color:
        var(--text);

      display: flex;

      align-items: center;

      justify-content:
        space-between;

      cursor: pointer;

      font-size: 13px;

      transition:
        border-color 0.2s;
    }

    .dropdown-select-btn:hover {
      border-color:
        rgba(255,255,255,0.2);
    }

    .selected-value {
      display: flex;

      align-items: center;

      gap: 10px;

      overflow: hidden;

      white-space: nowrap;

      text-overflow: ellipsis;
    }

    .selected-value img {
      width: 18px;
      height: 18px;

      object-fit: contain;

      flex-shrink: 0;
    }

    .dropdown-panel {
      position: absolute;

      bottom:
        calc(100% + 6px);

      left: 0;

      width: 100%;

      background:
        #15151b;

      border:
        1px solid var(--border);

      border-radius: 12px;

      box-shadow:
        0 -20px 40px rgba(0,0,0,0.8);

      z-index: 100;

      display: none;

      flex-direction: column;

      max-height: 360px;

      overflow: hidden;
    }

    .dropdown-panel.open {
      display: flex;
    }

    .dropdown-search-box {
      padding: 10px;

      border-bottom:
        1px solid var(--border);

      background:
        #0f0f13;

      flex-shrink: 0;
    }

    .dropdown-search-box input {
      width: 100%;

      background:
        rgba(0,0,0,0.4);

      border:
        1px solid var(--border);

      border-radius: 8px;

      padding:
        8px 10px;

      color:
        var(--text);

      font-size: 12px;

      outline: none;
    }

    .dropdown-search-box input:focus {
      border-color:
        var(--accent);
    }

    .dropdown-options-list {
      overflow-y: auto;

      max-height: 300px;

      padding: 4px;
    }

    .brand-group-title {
      font-size: 10px;

      font-weight: 700;

      color:
        var(--text-muted);

      padding:
        8px 8px 4px 8px;

      text-transform:
        uppercase;

      letter-spacing:
        0.5px;
    }

    .dropdown-option {
      display: flex;

      align-items: center;

      justify-content:
        space-between;

      padding:
        8px 10px;

      border-radius: 6px;

      cursor: pointer;

      transition:
        background 0.15s;
    }

    .dropdown-option:hover {
      background:
        var(--panel-hover);
    }

    .opt-left {
      display: flex;

      align-items: center;

      gap: 8px;

      overflow: hidden;

      min-width: 0;
    }

    .opt-left img {
      width: 18px;
      height: 18px;

      object-fit: contain;

      flex-shrink: 0;

      display: block;
    }

    .opt-name {
      font-size: 12px;

      color:
        var(--text);

      white-space: nowrap;

      overflow: hidden;

      text-overflow: ellipsis;
    }

    .badge {
      font-size: 9px;

      font-weight: 700;

      padding:
        2px 6px;

      border-radius: 4px;

      text-transform:
        uppercase;

      letter-spacing:
        0.5px;

      flex-shrink: 0;
    }

    .badge.free {
      background:
        var(--free-bg);

      color:
        var(--free-text);
    }

    .badge.paid {
      background:
        var(--paid-bg);

      color:
        var(--paid-text);
    }

    textarea {
      width: 100%;

      height: 140px;

      background:
        rgba(0,0,0,0.5);

      color:
        var(--text);

      border:
        1px solid var(--border);

      padding: 14px;

      border-radius: 12px;

      font-size: 13px;

      resize: none;

      outline: none;

      transition:
        border-color 0.2s;

      line-height: 1.5;
    }

    textarea:focus {
      border-color:
        var(--accent);
    }

    button.execute-btn {
      background:
        var(--accent);

      color:
        #fff;

      border: none;

      padding: 13px;

      font-weight: 600;

      border-radius: 12px;

      cursor: pointer;

      transition:
        background 0.2s,
        transform 0.1s;

      font-size: 13px;

      width: 100%;

      margin-top: 4px;
    }

    button.execute-btn:hover {
      background:
        var(--accent-hover);
    }

    button.execute-btn:active {
      transform:
        scale(0.99);
    }

    button.execute-btn:disabled {
      opacity: 0.55;

      cursor: not-allowed;
    }

    main {
      flex: 1;

      background:
        var(--bg);

      display: flex;

      flex-direction: column;

      padding: 24px;

      gap: 16px;

      height: 100%;

      overflow: hidden;
    }

    .console-header {
      display: flex;

      justify-content:
        space-between;

      align-items: center;
    }

    .console-container {
      flex: 1;

      background:
        var(--panel);

      border:
        1px solid var(--border);

      border-radius: 16px;

      padding: 20px;

      display: flex;

      flex-direction: column;

      overflow: hidden;

      box-shadow:
        inset 0 2px 10px rgba(0,0,0,0.5);
    }

    pre {
      color:
        #34d399;

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;

      font-size: 13px;

      line-height: 1.6;

      overflow-y: auto;

      flex: 1;

      white-space: pre-wrap;

      word-break: break-word;
    }

    .no-icon {
      width: 18px;
      height: 18px;

      border-radius: 5px;

      background:
        #24242d;

      border:
        1px solid
        rgba(255,255,255,0.08);

      flex-shrink: 0;
    }

    @media (max-width: 850px) {
      sidebar {
        width: 360px;
      }
    }
  </style>
</head>

<body>

  <div class="app-layout">

    <sidebar>

      <header>

        <div class="logo-area">

          <h1>
            Delta AI Hub
            <span>MCP v3.6</span>
          </h1>

        </div>

        <div class="status-badge">

          <div
            id="dot"
            class="dot"
          ></div>

          <span id="status-text">
            Connecting...
          </span>

        </div>

      </header>

      <div
        class="telemetry-card disconnected"
        id="telemetry-card"
      >

        <img
          id="game-icon"
          class="game-icon"
          alt="Game Icon"
          style="display:none"
        >

        <div
          id="game-icon-placeholder"
          class="game-icon"
        ></div>

        <div class="telemetry-info">

          <span
            id="game-name"
            class="game-title"
          >
            Waiting for session...
          </span>

          <span
            id="player-name"
            class="player-name"
          >
            No Delta client connected
          </span>

        </div>

      </div>

      <div class="control-group">

        <label for="prompt">
          AI Task Prompt
        </label>

        <textarea
          id="prompt"
          placeholder="Ask AI to perform a task..."
        ></textarea>

      </div>

      <div class="control-group">

        <label>
          Select AI Model
        </label>

        <div
          class="custom-dropdown"
          id="model-dropdown"
        >

          <div
            class="dropdown-select-btn"
            onclick="toggleDropdown()"
          >

            <div
              class="selected-value"
              id="selected-display"
            >
              <span>
                Loading model catalog...
              </span>
            </div>

            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path
                d="M6 15l6-6 6 6"
              />
            </svg>

          </div>

          <div
            class="dropdown-panel"
            id="dropdown-panel"
          >

            <div
              class="dropdown-search-box"
            >

              <input
                type="text"
                id="model-search"
                placeholder="Search models or brands..."
                oninput="filterModels(this.value)"
              >

            </div>

            <div
              class="dropdown-options-list"
              id="options-list"
            ></div>

          </div>

        </div>

      </div>

      <button
        class="execute-btn"
        id="exec-btn"
        onclick="sendAICommand()"
      >
        Execute Task
      </button>

    </sidebar>

    <main>

      <div class="console-header">

        <label>
          Execution Output & Live Telemetry Logs
        </label>

      </div>

      <div class="console-container">

        <pre id="output">System initialized. Awaiting commands...</pre>

      </div>

    </main>

  </div>

  <script>

    let allModelsData = [];

    let selectedModelId =
      "google/gemini-2.5-flash";

    // ========================================================
    // ICON HELPERS
    // ========================================================

    function createIcon(url, alt = "") {
      if (!url) {
        const placeholder =
          document.createElement("div");

        placeholder.className =
          "no-icon";

        return placeholder;
      }

      const img =
        document.createElement("img");

      img.src = url;
      img.alt = alt;

      img.loading = "eager";
      img.decoding = "async";

      img.width = 18;
      img.height = 18;

      img.style.objectFit =
        "contain";

      // Do NOT replace a failed icon
      // with another AI's logo.
      //
      // That was one of the problems
      // with the previous implementation.
      img.onerror = () => {
        img.replaceWith(
          createIcon("")
        );
      };

      return img;
    }

    // ========================================================
    // MODEL CATALOG
    // ========================================================

    async function fetchModelsCatalog() {

      try {

        const res =
          await fetch(
            "/api/models",
            {
              cache: "no-store"
            }
          );

        if (!res.ok) {
          throw new Error(
            "HTTP " + res.status
          );
        }

        allModelsData =
          await res.json();

        renderDropdownOptions(
          allModelsData
        );

        const defaultModel =
          allModelsData.find(
            m =>
              m.id ===
              selectedModelId
          ) ||
          allModelsData[0];

        if (defaultModel) {
          setSelectedModel(
            defaultModel
          );
        }

      } catch (e) {

        const selected =
          document.getElementById(
            "selected-display"
          );

        selected.innerHTML = "";

        const text =
          document.createElement(
            "span"
          );

        text.textContent =
          "Failed to load models";

        selected.appendChild(text);

        console.error(
          "Model catalog error:",
          e
        );
      }
    }

    function renderDropdownOptions(
      models
    ) {

      const listEl =
        document.getElementById(
          "options-list"
        );

      listEl.innerHTML = "";

      if (!models.length) {

        const empty =
          document.createElement(
            "div"
          );

        empty.style.padding =
          "14px";

        empty.style.color =
          "var(--text-muted)";

        empty.style.fontSize =
          "12px";

        empty.textContent =
          "No models found.";

        listEl.appendChild(empty);

        return;
      }

      const grouped = {};

      models.forEach(model => {

        const brand =
          model.brand ||
          "OTHER";

        if (!grouped[brand]) {
          grouped[brand] = [];
        }

        grouped[brand].push(
          model
        );
      });

      const brands =
        Object.keys(grouped)
          .sort((a, b) =>
            a.localeCompare(b)
          );

      for (const brand of brands) {

        const groupTitle =
          document.createElement(
            "div"
          );

        groupTitle.className =
          "brand-group-title";

        groupTitle.textContent =
          brand;

        listEl.appendChild(
          groupTitle
        );

        grouped[brand].forEach(
          model => {

            const opt =
              document.createElement(
                "div"
              );

            opt.className =
              "dropdown-option";

            opt.onclick = () => {

              setSelectedModel(
                model
              );

              toggleDropdown();
            };

            const left =
              document.createElement(
                "div"
              );

            left.className =
              "opt-left";

            const icon =
              createIcon(
                model.iconUrl,
                model.name
              );

            left.appendChild(
              icon
            );

            const name =
              document.createElement(
                "span"
              );

            name.className =
              "opt-name";

            name.title =
              model.id;

            name.textContent =
              model.name;

            left.appendChild(
              name
            );

            const badge =
              document.createElement(
                "span"
              );

            badge.className =
              "badge " +
              (
                model.isFree
                  ? "free"
                  : "paid"
              );

            badge.textContent =
              model.isFree
                ? "Free"
                : "Paid";

            opt.appendChild(
              left
            );

            opt.appendChild(
              badge
            );

            listEl.appendChild(
              opt
            );
          }
        );
      }
    }

    function setSelectedModel(
      model
    ) {

      selectedModelId =
        model.id;

      const display =
        document.getElementById(
          "selected-display"
        );

      display.innerHTML = "";

      const icon =
        createIcon(
          model.iconUrl,
          model.name
        );

      display.appendChild(
        icon
      );

      const text =
        document.createElement(
          "span"
        );

      text.textContent =
        model.name;

      display.appendChild(
        text
      );
    }

    function toggleDropdown() {

      const panel =
        document.getElementById(
          "dropdown-panel"
        );

      panel.classList.toggle(
        "open"
      );

      if (
        panel.classList.contains(
          "open"
        )
      ) {

        const search =
          document.getElementById(
            "model-search"
          );

        search.focus();

        search.select();
      }
    }

    function filterModels(
      query
    ) {

      const q =
        query
          .trim()
          .toLowerCase();

      if (!q) {

        renderDropdownOptions(
          allModelsData
        );

        return;
      }

      const filtered =
        allModelsData.filter(
          model => {

            return (
              model.id
                .toLowerCase()
                .includes(q) ||

              model.name
                .toLowerCase()
                .includes(q) ||

              model.brand
                .toLowerCase()
                .includes(q) ||

              (
                model.provider ||
                ""
              )
                .toLowerCase()
                .includes(q)
            );
          }
        );

      renderDropdownOptions(
        filtered
      );
    }

    window.onclick =
      function(event) {

        if (
          !event.target.closest(
            "#model-dropdown"
          )
        ) {

          document
            .getElementById(
              "dropdown-panel"
            )
            .classList.remove(
              "open"
            );
        }
      };

    // ========================================================
    // LIVE TELEMETRY
    // ========================================================

    function setDisconnectedUI() {

      const card =
        document.getElementById(
          "telemetry-card"
        );

      const icon =
        document.getElementById(
          "game-icon"
        );

      const placeholder =
        document.getElementById(
          "game-icon-placeholder"
        );

      const gameName =
        document.getElementById(
          "game-name"
        );

      const playerName =
        document.getElementById(
          "player-name"
        );

      const dot =
        document.getElementById(
          "dot"
        );

      const status =
        document.getElementById(
          "status-text"
        );

      card.classList.add(
        "disconnected"
      );

      dot.classList.remove(
        "connected"
      );

      status.textContent =
        "Waiting for Delta...";

      // CRITICAL:
      // Actually clear the old game info.
      gameName.textContent =
        "Waiting for session...";

      playerName.textContent =
        "No Delta client connected";

      icon.removeAttribute(
        "src"
      );

      icon.style.display =
        "none";

      placeholder.style.display =
        "block";
    }

    function setConnectedUI(
      data
    ) {

      const card =
        document.getElementById(
          "telemetry-card"
        );

      const icon =
        document.getElementById(
          "game-icon"
        );

      const placeholder =
        document.getElementById(
          "game-icon-placeholder"
        );

      const gameName =
        document.getElementById(
          "game-name"
        );

      const playerName =
        document.getElementById(
          "player-name"
        );

      const dot =
        document.getElementById(
          "dot"
        );

      const status =
        document.getElementById(
          "status-text"
        );

      card.classList.remove(
        "disconnected"
      );

      dot.classList.add(
        "connected"
      );

      status.textContent =
        "Delta Connected";

      gameName.textContent =
        data.gameName ||
        "Unknown Game";

      playerName.textContent =
        "Player: " +
        (
          data.username ||
          "Unknown"
        );

      if (data.iconUrl) {

        icon.src =
          data.iconUrl;

        icon.style.display =
          "block";

        placeholder.style.display =
          "none";

      } else {

        icon.removeAttribute(
          "src"
        );

        icon.style.display =
          "none";

        placeholder.style.display =
          "block";
      }
    }

    async function updateStatus() {

      try {

        const res =
          await fetch(
            "/status-check",
            {
              cache: "no-store"
            }
          );

        if (!res.ok) {
          throw new Error(
            "HTTP " + res.status
          );
        }

        const data =
          await res.json();

        if (
          data.connected === true
        ) {

          setConnectedUI(
            data
          );

        } else {

          setDisconnectedUI();
        }

      } catch (e) {

        // Treat a failed heartbeat
        // as disconnected so stale
        // game information never remains.
        setDisconnectedUI();
      }
    }

    // ========================================================
    // AI COMMAND
    // ========================================================

    async function sendAICommand() {

      const promptText =
        document.getElementById(
          "prompt"
        ).value;

      const outputEl =
        document.getElementById(
          "output"
        );

      const btn =
        document.getElementById(
          "exec-btn"
        );

      if (!promptText.trim()) {
        return;
      }

      btn.disabled = true;

      outputEl.innerText =
        "[STAGE 1/3] Connecting to OpenRouter and packaging live player telemetry context...";

      try {

        const res =
          await fetch(
            "/ai-chat",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  prompt:
                    promptText,

                  model:
                    selectedModelId
                })
            }
          );

        const data =
          await res.json();

        if (!res.ok) {

          throw new Error(
            data.output ||
            data.aiResponse ||
            "Request failed"
          );
        }

        outputEl.innerText =
          "[STAGE 2/3] AI generated the response. Dispatching command through the Delta polling bridge...";

        outputEl.innerText =
          "[STAGE 3/3] Execution Complete.\\n\\n" +
          "--- AI RESPONSE ---\\n" +
          (
            data.aiResponse ||
            "No response text"
          ) +
          "\\n\\n" +
          "--- DEVICE EXECUTION RESULT ---\\n" +
          (
            data.output ||
            "No execution output"
          );

      } catch (err) {

        outputEl.innerText =
          "Network / Processing Error: " +
          err.message;

      } finally {

        btn.disabled = false;
      }
    }

    // ========================================================
    // INITIALIZATION
    // ========================================================

    fetchModelsCatalog();

    updateStatus();

    // 2 second heartbeat.
    // The server itself uses an 8 second timeout,
    // so losing Delta causes the UI to clear shortly
    // after the final poll.
    setInterval(
      updateStatus,
      2000
    );

  </script>

</body>
</html>`);
});

// ============================================================
// AI CHAT
// ============================================================

app.post(
  "/ai-chat",
  async (req, res) => {

    const {
      prompt,
      model
    } = req.body || {};

    if (
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      return res.status(400).json({
        aiResponse: "Invalid request.",
        output:
          "A non-empty prompt is required."
      });
    }

    const selectedModel =
      model ||
      "google/gemini-2.5-flash";

    try {

      // ALWAYS obtain fresh state here.
      // Never trust the old clientInfo.connected flag.
      const liveClient =
        getLiveClientInfo();

      const contextPrompt = `
You are an expert Roblox Luau automation assistant controlling Delta on iOS.

CURRENT LIVE TELEMETRY CONTEXT:

Connection Status:
${liveClient.connected ? "Active" : "Disconnected"}

Connected Player Username:
${
  liveClient.connected
    ? liveClient.username
    : "No connected player"
}

Current Game:
${
  liveClient.connected
    ? liveClient.gameName
    : "No game session"
}

IMPORTANT:
If the Delta client is disconnected, do not claim that a player is currently connected or that they are currently inside a game.

The user wants you to perform this task:

"${prompt}"

Format executable Luau strictly inside a standard markdown code block using triple backticks with "luau" or "lua".

If no script is needed, output a normal text response.
`;

      const completion =
        await openrouter.chat.completions.create(
          {
            model:
              selectedModel,

            messages: [
              {
                role: "system",
                content:
                  contextPrompt
              },

              {
                role: "user",
                content:
                  prompt
              }
            ]
          }
        );

      const aiText =
        completion
          .choices?.[0]
          ?.message?.content ||
        "No response received from model.";

      const match =
        aiText.match(
          /```(?:luau|lua)?([\\s\\S]*?)```/i
        );

      const codeToRun =
        match
          ? match[1].trim()
          : `print([==[${aiText}]==])`;

      const cmdId =
        "cmd_" +
        Date.now();

      pendingCommands.push({
        id: cmdId,
        action: "execute_luau",
        payload: {
          code: codeToRun
        }
      });

      let attempts = 0;

      while (
        !commandResults[cmdId] &&
        attempts < 35
      ) {

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              500
            )
        );

        attempts++;
      }

      const result =
        commandResults[cmdId] || {
          status: "timeout",

          output:
            "Execution timed out. Delta did not poll back a result in time."
        };

      delete commandResults[
        cmdId
      ];

      res.json({
        aiResponse:
          aiText,

        output:
          result.output,

        status:
          result.status
      });

    } catch (err) {

      console.error(
        "OpenRouter Route Error:",
        err
      );

      res.status(500).json({
        aiResponse:
          "OpenRouter request failed.",

        output:
          "OpenRouter API Error: " +
          (
            err?.message ||
            "Unknown error"
          )
      });
    }
  }
);

// ============================================================
// SERVER
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `Delta MCP Server running on port ${PORT}`
    );
  }
);

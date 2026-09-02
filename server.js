// ============================================================
// DELTA AI HUB
// Full Express + MCP + OpenRouter Dashboard
// ============================================================

const express = require("express");
const OpenAI = require("openai");

const {
    Server
} = require("@modelcontextprotocol/sdk/server/index.js");

const {
    SSEServerTransport
} = require("@modelcontextprotocol/sdk/server/sse.js");

const {
    CallToolRequestSchema,
    ListToolsRequestSchema
} = require("@modelcontextprotocol/sdk/types.js");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({
    limit: "1mb"
}));


// ============================================================
// CONFIG
// ============================================================

const OPENROUTER_MODELS_URL =
    "https://openrouter.ai/api/v1/models";

const OPENROUTER_CHAT_URL =
    "https://openrouter.ai/api/v1/chat/completions";

const CONNECTION_TIMEOUT = 8000;

const LOBE_ICON_CDN =
    "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/";

const LOBE_ICON_MIRROR =
    "https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/";


// ============================================================
// DELTA CLIENT STATE
// ============================================================

let clientInfo = {
    connected: false,
    username: "",
    userId: "",
    gameName: "",
    gameId: "",
    placeId: "",
    gameIcon: "",
    avatar: "",
    lastPollTime: 0
};

let pendingCommands = [];
let commandResults = new Map();

let commandCounter = 0;


// ============================================================
// CONNECTION HELPERS
// ============================================================

function isClientConnected() {
    if (!clientInfo.lastPollTime) {
        return false;
    }

    return (
        Date.now() - clientInfo.lastPollTime
    ) < CONNECTION_TIMEOUT;
}


function getLiveClientInfo() {

    if (!isClientConnected()) {
        return {
            connected: false,
            username: "",
            userId: "",
            gameName: "",
            gameId: "",
            placeId: "",
            gameIcon: "",
            avatar: ""
        };
    }

    return {
        connected: true,
        username: clientInfo.username || "",
        userId: clientInfo.userId || "",
        gameName: clientInfo.gameName || "",
        gameId: clientInfo.gameId || "",
        placeId: clientInfo.placeId || "",
        gameIcon: clientInfo.gameIcon || "",
        avatar: clientInfo.avatar || ""
    };
}


function clearDisconnectedClient() {

    if (isClientConnected()) {
        return;
    }

    clientInfo = {
        connected: false,
        username: "",
        userId: "",
        gameName: "",
        gameId: "",
        placeId: "",
        gameIcon: "",
        avatar: "",
        lastPollTime: 0
    };
}


// Periodically remove stale telemetry.
setInterval(() => {
    clearDisconnectedClient();
}, 1000);


// ============================================================
// SAFE STRING HELPERS
// ============================================================

function cleanString(value, maxLength = 500) {

    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\0/g, "")
        .slice(0, maxLength);
}


function normalizeProvider(value) {

    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/_/g, "-");
}


// ============================================================
// LOBEHUB ICON MAP
// ============================================================
//
// IMPORTANT:
// We deliberately map PROVIDERS, not model families.
//
// Bad:
//   "llama" -> Meta
//
// Good:
//   "meta-llama/..." -> Meta
//   "aion-labs/..."  -> AionLabs
//   "cognitive/..."  -> Deep Cogito
//
// This prevents unrelated providers from inheriting another
// company's logo.
// ============================================================

const PROVIDER_ICON_MAP = {

    // OpenAI
    "openai": "openai",

    // Anthropic
    //
    // This is intentionally ANTHROPIC, not CLAUDE.
    // The user-facing provider logo should be Anthropic's
    // stylized A mark.
    "anthropic": "anthropic",

    // Google
    "google": "google",
    "google-ai": "google",
    "google-ai-studio": "google",

    // Meta
    "meta": "meta",
    "meta-llama": "meta",

    // Mistral
    "mistral": "mistral",
    "mistralai": "mistral",

    // DeepSeek
    "deepseek": "deepseek",

    // Qwen
    "qwen": "qwen",
    "alibaba": "qwen",
    "alibaba-cloud": "qwen",

    // Cohere
    "cohere": "cohere",

    // xAI
    "x-ai": "xai",
    "xai": "xai",

    // Groq
    "groq": "groq",

    // Perplexity
    "perplexity": "perplexity",

    // Microsoft
    "microsoft": "microsoft",

    // NVIDIA
    "nvidia": "nvidia",

    // Amazon
    "amazon": "aws",
    "amazon-bedrock": "aws",

    // AI21
    "ai21": "ai21",
    "ai21-labs": "ai21",

    // Together
    "together": "together",
    "together-ai": "together",

    // Fireworks
    "fireworks": "fireworks",

    // Moonshot
    "moonshot": "moonshot",
    "moonshotai": "moonshot",

    // MiniMax
    "minimax": "minimax",
    "minimaxai": "minimax",

    // Zhipu / Z-AI
    "zhipuai": "zhipu",
    "zhipu": "zhipu",
    "z-ai": "z-ai",
    "zai": "z-ai",

    // 01.AI
    "01-ai": "01-ai",
    "01ai": "01-ai",

    // Baichuan
    "baichuan": "baichuan",

    // ByteDance
    "bytedance": "bytedance",

    // Doubao
    "doubao": "doubao",

    // StepFun
    "stepfun": "stepfun",

    // Databricks
    "databricks": "dbrx",

    // AI2
    "ai2": "ai2",

    // Inflection
    "inflection": "inflection",

    // Reka
    "reka": "reka",

    // Liquid
    "liquid": "liquid",

    // Nous
    "nousresearch": "nousresearch",
    "nous-research": "nousresearch",
    "nous": "nousresearch",

    // Cloudflare
    "cloudflare": "cloudflare",

    // OpenRouter
    "openrouter": "openrouter",

    // Tencent
    "tencent": "tencent",

    // Xiaomi
    "xiaomi": "xiaomi",

    // Ling
    "ling": "ling",

    // Poolside
    "poolside": "poolside",

    // KWAIPilot
    "kwaipilot": "kwaipilot",

    // AionLabs
    //
    // NEVER map this to Meta.
    "aionlabs": "aionlabs",
    "aion-labs": "aionlabs",

    // Cognitive / Deep Cogito
    //
    // NEVER map this to Mistral.
    "cognitive": "deep-cogito",
    "cogito": "deep-cogito",
    "deepcogito": "deep-cogito",
    "deep-cogito": "deep-cogito",

    // Sao10K
    "sao10k": "sao10k",

    // Alpindale
    "alpindale": "alpindale",

    // Undi95
    "undi95": "undi95",

    // Mancer
    "mancer": "mancer",

    // NeverSleep
    "neversleep": "neversleep",

    // TheDrummer
    "thedrummer": "thedrummer"
};


// ============================================================
// SPECIAL PROVIDER ALIASES
// ============================================================

const PROVIDER_ALIASES = {

    "aion-labs": "aionlabs",
    "aion_labs": "aionlabs",

    "deep-cogito": "deep-cogito",
    "deep_cogito": "deep-cogito",

    "meta-llama": "meta-llama",

    "moonshot-ai": "moonshotai",

    "z-ai": "z-ai",

    "ai21-labs": "ai21",

    "together-ai": "together"
};


// ============================================================
// MODEL ID -> PROVIDER
// ============================================================
//
// OpenRouter model IDs normally look like:
//
//   openai/gpt-5
//   anthropic/claude-3.7-sonnet
//   meta-llama/llama-3.3-70b
//   aion-labs/... 
//
// The FIRST segment is therefore much safer than trying to
// determine a company from the model's name.
// ============================================================

function getProviderFromModelId(modelId) {

    const id = String(modelId || "")
        .trim()
        .toLowerCase();

    if (!id) {
        return "";
    }

    const slashIndex = id.indexOf("/");

    if (slashIndex !== -1) {

        let provider =
            id.slice(0, slashIndex);

        provider =
            PROVIDER_ALIASES[provider] ||
            provider;

        return provider;
    }

    return "";
}


// ============================================================
// MODEL ICON SLUG
// ============================================================

function getIconSlug(model) {

    const modelId =
        String(model?.id || "").trim();

    const provider =
        getProviderFromModelId(modelId);

    if (provider && PROVIDER_ICON_MAP[provider]) {
        return PROVIDER_ICON_MAP[provider];
    }

    // Some OpenRouter responses can expose a provider field.
    const explicitProvider =
        normalizeProvider(
            model?.provider?.slug ||
            model?.provider?.id ||
            model?.provider?.name ||
            ""
        );

    if (
        explicitProvider &&
        PROVIDER_ICON_MAP[explicitProvider]
    ) {
        return PROVIDER_ICON_MAP[explicitProvider];
    }

    // No guessing from "llama", "gpt", "claude", etc.
    // This is intentional.
    return null;
}


// ============================================================
// ICON URLS
// ============================================================

function getIconUrls(model) {

    const slug = getIconSlug(model);

    if (!slug) {
        return [];
    }

    return [
        `${LOBE_ICON_CDN}${slug}.svg`,
        `${LOBE_ICON_MIRROR}${slug}.svg`
    ];
}


// ============================================================
// FETCH OPENROUTER MODELS
// ============================================================

let modelCache = [];
let modelCacheTime = 0;

const MODEL_CACHE_TIME = 60 * 1000;


async function fetchOpenRouterModels() {

    if (
        modelCache.length &&
        Date.now() - modelCacheTime < MODEL_CACHE_TIME
    ) {
        return modelCache;
    }

    const response =
        await fetch(OPENROUTER_MODELS_URL, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            },
            cache: "no-store"
        });

    if (!response.ok) {

        throw new Error(
            `OpenRouter model request failed: ${response.status}`
        );
    }

    const json =
        await response.json();

    if (!json || !Array.isArray(json.data)) {
        throw new Error("Invalid OpenRouter model response");
    }

    modelCache = json.data;
    modelCacheTime = Date.now();

    return modelCache;
}


// ============================================================
// MODEL RESPONSE FORMAT
// ============================================================

function formatModel(model) {

    const iconSlug =
        getIconSlug(model);

    const iconUrls =
        getIconUrls(model);

    const modelId =
        cleanString(model.id, 300);

    const modelName =
        cleanString(
            model.name ||
            model.id,
            300
        );

    const provider =
        getProviderFromModelId(modelId);

    return {
        id: modelId,

        name: modelName,

        provider,

        icon: iconSlug,

        iconUrls,

        contextLength:
            model.context_length || null,

        pricing:
            model.pricing || null,

        architecture:
            model.architecture || null
    };
}


// ============================================================
// API: MODELS
// ============================================================

app.get("/api/models", async (req, res) => {

    try {

        const models =
            await fetchOpenRouterModels();

        const formatted =
            models
                .filter(model => model && model.id)
                .map(formatModel);

        res.setHeader(
            "Cache-Control",
            "no-store"
        );

        res.json({
            ok: true,
            count: formatted.length,
            models: formatted
        });

    } catch (error) {

        console.error(
            "[Models]",
            error
        );

        res.status(500).json({
            ok: false,
            error: error.message,
            models: []
        });
    }
});


// ============================================================
// DELTA POLLING
// ============================================================

app.get("/delta/poll", (req, res) => {

    const incoming = req.query || {};

    clientInfo = {
        connected: true,

        username:
            cleanString(
                incoming.username,
                100
            ),

        userId:
            cleanString(
                incoming.userId,
                100
            ),

        gameName:
            cleanString(
                incoming.gameName,
                200
            ),

        gameId:
            cleanString(
                incoming.gameId,
                100
            ),

        placeId:
            cleanString(
                incoming.placeId,
                100
            ),

        gameIcon:
            cleanString(
                incoming.gameIcon,
                1000
            ),

        avatar:
            cleanString(
                incoming.avatar,
                1000
            ),

        lastPollTime: Date.now()
    };

    const commands =
        pendingCommands.splice(
            0,
            pendingCommands.length
        );

    res.setHeader(
        "Cache-Control",
        "no-store"
    );

    res.json({
        ok: true,
        connected: true,
        commands
    });
});


// ============================================================
// DELTA RESULT
// ============================================================

app.post("/delta/result", (req, res) => {

    const body =
        req.body || {};

    const commandId =
        cleanString(
            body.commandId,
            200
        );

    if (!commandId) {

        return res.status(400).json({
            ok: false,
            error: "Missing commandId"
        });
    }

    commandResults.set(
        commandId,
        {
            ok: body.ok !== false,
            result: body.result ?? null,
            error: body.error ?? null,
            timestamp: Date.now()
        }
    );

    // Keep memory under control.
    if (commandResults.size > 200) {

        const oldest =
            commandResults.keys().next().value;

        commandResults.delete(oldest);
    }

    res.json({
        ok: true
    });
});


// ============================================================
// STATUS CHECK
// ============================================================

app.get("/status-check", (req, res) => {

    clearDisconnectedClient();

    const live =
        getLiveClientInfo();

    res.setHeader(
        "Cache-Control",
        "no-store"
    );

    res.json(live);
});


// ============================================================
// QUEUE COMMAND
// ============================================================

function queueDeltaCommand(code) {

    const id =
        `cmd_${Date.now()}_${++commandCounter}`;

    const command = {
        id,
        type: "execute",
        code: String(code || ""),
        createdAt: Date.now()
    };

    pendingCommands.push(command);

    return id;
}


// ============================================================
// WAIT FOR COMMAND RESULT
// ============================================================

function waitForCommandResult(
    commandId,
    timeout = 30000
) {

    return new Promise(resolve => {

        const started =
            Date.now();

        const timer =
            setInterval(() => {

                const result =
                    commandResults.get(commandId);

                if (result) {

                    clearInterval(timer);

                    commandResults.delete(
                        commandId
                    );

                    resolve(result);

                    return;
                }

                if (
                    Date.now() - started >=
                    timeout
                ) {

                    clearInterval(timer);

                    resolve({
                        ok: false,
                        error: "Timed out waiting for Delta client"
                    });
                }

            }, 150);
    });
}


// ============================================================
// EXTRACT LUAU
// ============================================================

function extractLuau(text) {

    if (!text) {
        return null;
    }

    const fenced =
        text.match(
            /```(?:lua|luau)?\s*([\s\S]*?)```/i
        );

    if (fenced) {
        return fenced[1].trim();
    }

    // Only consider it executable if it looks like Luau.
    const looksLikeLuau =
        /\b(local|function|game|workspace|Instance|task|Vector3|UDim2|Color3)\b/
            .test(text);

    if (!looksLikeLuau) {
        return null;
    }

    return text.trim();
}


// ============================================================
// OPENROUTER CHAT
// ============================================================

async function askOpenRouter({
    apiKey,
    model,
    prompt,
    system
}) {

    if (!apiKey) {
        throw new Error("Missing OpenRouter API key");
    }

    if (!model) {
        throw new Error("Missing model");
    }

    const response =
        await fetch(
            OPENROUTER_CHAT_URL,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    "Authorization":
                        `Bearer ${apiKey}`,

                    "HTTP-Referer":
                        "http://localhost",

                    "X-Title":
                        "Delta AI Hub"
                },

                body: JSON.stringify({
                    model,

                    messages: [
                        {
                            role: "system",
                            content:
                                system ||
                                "You are a helpful AI assistant."
                        },

                        {
                            role: "user",
                            content: prompt
                        }
                    ],

                    temperature: 0.2
                })
            }
        );

    const text =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(text);
    } catch {
        data = {
            raw: text
        };
    }

    if (!response.ok) {

        const message =
            data?.error?.message ||
            data?.error ||
            text ||
            `HTTP ${response.status}`;

        throw new Error(
            String(message)
        );
    }

    return data;
}


// ============================================================
// AI CHAT
// ============================================================

app.post("/ai-chat", async (req, res) => {

    const {
        apiKey,
        model,
        prompt
    } = req.body || {};

    if (!apiKey) {

        return res.status(400).json({
            ok: false,
            error: "Missing API key"
        });
    }

    if (!model) {

        return res.status(400).json({
            ok: false,
            error: "Missing model"
        });
    }

    if (!prompt) {

        return res.status(400).json({
            ok: false,
            error: "Missing prompt"
        });
    }


    // CRITICAL:
    // Always get fresh telemetry.
    // Never give the AI stale game information.
    const live =
        getLiveClientInfo();


    const telemetry =
        live.connected
            ? [
                `Delta client connected: yes`,
                `Username: ${live.username || "Unknown"}`,
                `User ID: ${live.userId || "Unknown"}`,
                `Game: ${live.gameName || "Unknown"}`,
                `Game ID: ${live.gameId || "Unknown"}`,
                `Place ID: ${live.placeId || "Unknown"}`
            ].join("\n")
            : [
                "Delta client connected: no",
                "No live game information is available."
            ].join("\n");


    const systemPrompt = `
You are Delta AI Hub.

You are assisting the user through a Roblox development dashboard.

LIVE CLIENT INFORMATION:
${telemetry}

IMPORTANT:
Only use the game/player information above.
If the Delta client is disconnected, do not assume or reuse
previous game/player information.

When the user asks for Luau code, provide complete code.
`.trim();


    try {

        const data =
            await askOpenRouter({
                apiKey,
                model,
                prompt,
                system: systemPrompt
            });


        const answer =
            data?.choices?.[0]?.message?.content ||
            data?.choices?.[0]?.text ||
            "";


        const code =
            extractLuau(answer);


        let command = null;
        let execution = null;


        if (
            code &&
            live.connected
        ) {

            command =
                queueDeltaCommand(code);

            execution =
                await waitForCommandResult(
                    command,
                    30000
                );
        }


        res.json({
            ok: true,

            response: answer,

            code,

            commandId:
                command?.id || null,

            execution,

            client: getLiveClientInfo()
        });

    } catch (error) {

        console.error(
            "[AI]",
            error
        );

        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});


// ============================================================
// MCP SERVER
// ============================================================

const mcpServer =
    new Server(
        {
            name: "delta-ai-hub",
            version: "1.0.0"
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
                    name: "delta_status",

                    description:
                        "Returns the current live Delta client status.",

                    inputSchema: {
                        type: "object",
                        properties: {}
                    }
                },

                {
                    name: "queue_luau",

                    description:
                        "Queues Luau for the connected Delta client.",

                    inputSchema: {
                        type: "object",

                        properties: {
                            code: {
                                type: "string"
                            }
                        },

                        required: [
                            "code"
                        ]
                    }
                }
            ]
        };
    }
);


mcpServer.setRequestHandler(
    CallToolRequestSchema,
    async request => {

        const name =
            request.params.name;

        const args =
            request.params.arguments || {};


        if (name === "delta_status") {

            return {
                content: [
                    {
                        type: "text",

                        text: JSON.stringify(
                            getLiveClientInfo(),
                            null,
                            2
                        )
                    }
                ]
            };
        }


        if (name === "queue_luau") {

            const live =
                getLiveClientInfo();

            if (!live.connected) {

                return {
                    content: [
                        {
                            type: "text",

                            text:
                                "Delta client is not connected."
                        }
                    ],

                    isError: true
                };
            }


            const code =
                String(
                    args.code || ""
                );


            if (!code.trim()) {

                return {
                    content: [
                        {
                            type: "text",

                            text:
                                "No Luau code supplied."
                        }
                    ],

                    isError: true
                };
            }


            const commandId =
                queueDeltaCommand(code);


            return {
                content: [
                    {
                        type: "text",

                        text:
                            `Queued command ${commandId}`
                    }
                ]
            };
        }


        throw new Error(
            `Unknown tool: ${name}`
        );
    }
);


// ============================================================
// SSE
// ============================================================

const transports =
    new Map();


app.get("/sse", async (req, res) => {

    const transport =
        new SSEServerTransport(
            "/messages",
            res
        );

    transports.set(
        transport.sessionId,
        transport
    );


    res.on("close", () => {

        transports.delete(
            transport.sessionId
        );
    });


    await mcpServer.connect(
        transport
    );
});


app.post("/messages", async (req, res) => {

    const sessionId =
        req.query.sessionId;


    const transport =
        transports.get(
            sessionId
        );


    if (!transport) {

        return res.status(404).json({
            error:
                "MCP session not found"
        });
    }


    await transport.handlePostMessage(
        req,
        res
    );
});


// ============================================================
// DASHBOARD HTML
// ============================================================

app.get("/", (req, res) => {

    res.send(`<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
/>

<title>Delta AI Hub</title>

<style>

* {
    box-sizing: border-box;
}

html,
body {
    width: 100%;
    height: 100%;
    margin: 0;
}

body {
    background:
        radial-gradient(
            circle at top left,
            #18202b 0%,
            #0c1016 42%,
            #080a0e 100%
        );

    color: #f4f6f8;

    font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

    overflow: hidden;
}

button,
textarea,
input {
    font: inherit;
}

button {
    cursor: pointer;
}

.app {
    width: 100%;
    height: 100%;
    display: flex;
}

.sidebar {
    width: 265px;
    height: 100%;
    border-right: 1px solid rgba(255,255,255,.07);
    background: rgba(8,11,16,.82);
    backdrop-filter: blur(22px);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 750;
}

.brand-mark {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background:
        linear-gradient(
            135deg,
            #ffffff,
            #777d87
        );
    box-shadow:
        0 8px 24px rgba(255,255,255,.08);
}

.connection-card {
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.035);
    border-radius: 14px;
    padding: 13px;
}

.connection-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.status {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #9ca4b0;
    font-size: 11px;
}

.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #555b64;
}

.status.connected .status-dot {
    background: #4ade80;
    box-shadow:
        0 0 10px rgba(74,222,128,.7);
}

.player {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 13px;
}

.avatar {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    object-fit: cover;
    background: #171c24;
}

.player-name {
    font-size: 12px;
    font-weight: 700;
}

.game-name {
    margin-top: 2px;
    color: #737c89;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.section-label {
    color: #666f7c;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .08em;
    font-weight: 700;
    margin-top: 4px;
}

.history {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.history-item {
    padding: 10px;
    border-radius: 10px;
    color: #a9b0ba;
    font-size: 11px;
    margin-bottom: 4px;
}

.history-item:hover {
    background: rgba(255,255,255,.04);
    color: white;
}

.main {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.topbar {
    height: 62px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
}

.page-title {
    font-size: 14px;
    font-weight: 700;
}

.page-subtitle {
    color: #68717e;
    font-size: 10px;
    margin-top: 3px;
}

.model-button {
    min-width: 220px;
    border: 1px solid rgba(255,255,255,.09);
    background: rgba(255,255,255,.045);
    color: white;
    border-radius: 11px;
    padding: 9px 12px;
    display: flex;
    align-items: center;
    gap: 9px;
}

.model-button:hover {
    background: rgba(255,255,255,.07);
}

.model-button-icon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    object-fit: contain;
}

.model-button-name {
    flex: 1;
    text-align: left;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 24px;
}

.chat {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 7px;
}

.message {
    max-width: 850px;
    margin: 0 auto 18px;
}

.message-user {
    background: rgba(255,255,255,.045);
    border: 1px solid rgba(255,255,255,.06);
    padding: 13px 15px;
    border-radius: 14px;
}

.message-ai {
    padding: 4px 15px;
}

.message-role {
    color: #68717e;
    font-size: 10px;
    margin-bottom: 7px;
    text-transform: uppercase;
    letter-spacing: .07em;
}

.message-content {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.55;
    font-size: 13px;
    color: #dce1e7;
}

.composer {
    width: min(850px, 100%);
    margin: 12px auto 0;
    border: 1px solid rgba(255,255,255,.09);
    background: rgba(10,13,18,.88);
    border-radius: 16px;
    padding: 10px;
    box-shadow:
        0 18px 60px rgba(0,0,0,.28);
}

.prompt {
    width: 100%;
    min-height: 85px;
    max-height: 230px;
    resize: vertical;
    border: 0;
    outline: 0;
    background: transparent;
    color: white;
    padding: 7px;
}

.prompt::placeholder {
    color: #59616d;
}

.composer-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
}

.composer-hint {
    color: #535c68;
    font-size: 10px;
}

.send {
    border: 0;
    border-radius: 9px;
    padding: 9px 15px;
    color: #080a0e;
    background: white;
    font-weight: 750;
}

.send:hover {
    background: #e5e7eb;
}

.model-menu {
    position: fixed;
    top: 58px;
    right: 24px;
    width: 350px;
    max-height: 560px;
    display: none;
    flex-direction: column;
    border: 1px solid rgba(255,255,255,.09);
    background: rgba(12,15,20,.97);
    backdrop-filter: blur(25px);
    border-radius: 14px;
    box-shadow:
        0 25px 80px rgba(0,0,0,.5);
    z-index: 100;
    overflow: hidden;
}

.model-menu.open {
    display: flex;
}

.model-search {
    margin: 10px;
    width: calc(100% - 20px);
    border: 1px solid rgba(255,255,255,.08);
    outline: none;
    border-radius: 9px;
    background: rgba(255,255,255,.045);
    color: white;
    padding: 9px 10px;
    font-size: 11px;
}

.model-list {
    overflow-y: auto;
    min-height: 0;
    padding: 4px 7px 8px;
}

.model-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: white;
    text-align: left;
}

.model-row:hover {
    background: rgba(255,255,255,.05);
}

.model-icon {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 8px;
    background: rgba(255,255,255,.035);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.model-icon img {
    width: 19px;
    height: 19px;
    object-fit: contain;
    display: block;
}

.model-icon.no-icon::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #424852;
}

.model-info {
    min-width: 0;
    flex: 1;
}

.model-name {
    font-size: 11px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.model-id {
    color: #59616d;
    font-size: 9px;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

::-webkit-scrollbar {
    width: 6px;
}

::-webkit-scrollbar-track {
    background: transparent;
}

::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,.09);
    border-radius: 20px;
}

.empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4f5763;
    font-size: 12px;
}

@media(max-width: 760px) {

    .sidebar {
        display: none;
    }

    .topbar {
        padding: 0 14px;
    }

    .workspace {
        padding: 14px;
    }

    .model-button {
        min-width: 160px;
    }

    .model-menu {
        left: 14px;
        right: 14px;
        width: auto;
    }
}

</style>

</head>

<body>

<div class="app">

    <aside class="sidebar">

        <div class="brand">
            <div class="brand-mark"></div>
            <span>Delta AI Hub</span>
        </div>

        <div class="connection-card">

            <div class="connection-head">

                <div class="section-label">
                    Client
                </div>

                <div
                    id="status"
                    class="status"
                >
                    <span class="status-dot"></span>
                    <span id="statusText">
                        Waiting for Delta...
                    </span>
                </div>

            </div>

            <div
                id="player"
                class="player"
            >

                <img
                    id="avatar"
                    class="avatar"
                    alt=""
                >

                <div
                    style="min-width:0"
                >

                    <div
                        id="playerName"
                        class="player-name"
                    >
                        Not connected
                    </div>

                    <div
                        id="gameName"
                        class="game-name"
                    >
                        No game detected
                    </div>

                </div>

            </div>

        </div>

        <div class="section-label">
            Chats
        </div>

        <div
            id="history"
            class="history"
        ></div>

    </aside>


    <main class="main">

        <header class="topbar">

            <div>
                <div class="page-title">
                    AI Workspace
                </div>

                <div class="page-subtitle">
                    Connected to your Delta client
                </div>
            </div>


            <button
                id="modelButton"
                class="model-button"
            >

                <div
                    id="modelButtonIcon"
                    class="model-icon"
                ></div>

                <div
                    id="modelButtonName"
                    class="model-button-name"
                >
                    Select model
                </div>

                <span>
                    ▾
                </span>

            </button>

        </header>


        <section class="workspace">

            <div
                id="chat"
                class="chat"
            >

                <div
                    id="empty"
                    class="empty"
                >
                    Start a conversation
                </div>

            </div>


            <div class="composer">

                <textarea
                    id="prompt"
                    class="prompt"
                    placeholder="Ask Delta AI anything..."
                ></textarea>

                <div class="composer-bottom">

                    <div class="composer-hint">
                        Enter to send
                    </div>

                    <button
                        id="send"
                        class="send"
                    >
                        Send
                    </button>

                </div>

            </div>

        </section>

    </main>

</div>


<div
    id="modelMenu"
    class="model-menu"
>

    <input
        id="modelSearch"
        class="model-search"
        placeholder="Search models..."
    >

    <div
        id="modelList"
        class="model-list"
    ></div>

</div>


<script>

let models = [];
let selectedModel = null;


// ============================================================
// DOM
// ============================================================

const chat =
    document.getElementById("chat");

const empty =
    document.getElementById("empty");

const prompt =
    document.getElementById("prompt");

const send =
    document.getElementById("send");

const status =
    document.getElementById("status");

const statusText =
    document.getElementById("statusText");

const playerName =
    document.getElementById("playerName");

const gameName =
    document.getElementById("gameName");

const avatar =
    document.getElementById("avatar");

const modelButton =
    document.getElementById("modelButton");

const modelButtonName =
    document.getElementById("modelButtonName");

const modelButtonIcon =
    document.getElementById("modelButtonIcon");

const modelMenu =
    document.getElementById("modelMenu");

const modelSearch =
    document.getElementById("modelSearch");

const modelList =
    document.getElementById("modelList");


// ============================================================
// LOCAL STORAGE
// ============================================================

const API_KEY_STORAGE =
    "delta_ai_hub_openrouter_key";

const MODEL_STORAGE =
    "delta_ai_hub_model";


// ============================================================
// CONNECTION UI
// ============================================================

function setDisconnectedUI() {

    status.classList.remove(
        "connected"
    );

    statusText.textContent =
        "Waiting for Delta...";

    playerName.textContent =
        "Not connected";

    gameName.textContent =
        "No game detected";

    avatar.removeAttribute(
        "src"
    );

    avatar.style.display =
        "none";
}


function setConnectedUI(data) {

    status.classList.add(
        "connected"
    );

    statusText.textContent =
        "Connected";

    playerName.textContent =
        data.username ||
        "Unknown player";

    gameName.textContent =
        data.gameName ||
        "Unknown game";


    if (data.avatar) {

        avatar.src =
            data.avatar;

        avatar.style.display =
            "block";

    } else {

        avatar.removeAttribute(
            "src"
        );

        avatar.style.display =
            "none";
    }
}


// ============================================================
// STATUS POLLING
// ============================================================

async function checkStatus() {

    try {

        const response =
            await fetch(
                "/status-check",
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                "Status request failed"
            );
        }

        const data =
            await response.json();


        if (
            data.connected !== true
        ) {

            setDisconnectedUI();

            return;
        }


        setConnectedUI(data);

    } catch {

        setDisconnectedUI();
    }
}


// Check immediately.
checkStatus();

// Keep the dashboard live.
setInterval(
    checkStatus,
    1500
);


// ============================================================
// MODEL ICON
// ============================================================

function makeModelIcon(model) {

    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        "model-icon";


    const urls =
        Array.isArray(
            model.iconUrls
        )
            ? model.iconUrls
            : [];


    if (!urls.length) {

        wrapper.classList.add(
            "no-icon"
        );

        return wrapper;
    }


    const img =
        document.createElement(
            "img"
        );

    img.loading =
        "eager";

    img.decoding =
        "async";

    img.alt =
        "";

    img.draggable =
        false;


    let index = 0;


    function tryNext() {

        index++;

        if (
            index >= urls.length
        ) {

            // Do NOT substitute another
            // company's logo.
            img.remove();

            wrapper.classList.add(
                "no-icon"
            );

            return;
        }

        img.src =
            urls[index];
    }


    img.onerror =
        tryNext;

    img.src =
        urls[0];


    wrapper.appendChild(
        img
    );

    return wrapper;
}


// ============================================================
// MODEL LIST
// ============================================================

function renderModels(
    filter = ""
) {

    modelList.innerHTML =
        "";


    const search =
        filter
            .trim()
            .toLowerCase();


    const filtered =
        models.filter(model => {

            if (!search) {
                return true;
            }

            return (
                String(model.name || "")
                    .toLowerCase()
                    .includes(search)
                ||
                String(model.id || "")
                    .toLowerCase()
                    .includes(search)
                ||
                String(model.provider || "")
                    .toLowerCase()
                    .includes(search)
            );
        });


    if (!filtered.length) {

        const emptyRow =
            document.createElement(
                "div"
            );

        emptyRow.style.padding =
            "16px";

        emptyRow.style.color =
            "#59616d";

        emptyRow.style.fontSize =
            "11px";

        emptyRow.textContent =
            "No models found.";

        modelList.appendChild(
            emptyRow
        );

        return;
    }


    const fragment =
        document.createDocumentFragment();


    for (const model of filtered) {

        const row =
            document.createElement(
                "button"
            );

        row.className =
            "model-row";


        const icon =
            makeModelIcon(
                model
            );


        const info =
            document.createElement(
                "div"
            );

        info.className =
            "model-info";


        const name =
            document.createElement(
                "div"
            );

        name.className =
            "model-name";

        name.textContent =
            model.name ||
            model.id;


        const id =
            document.createElement(
                "div"
            );

        id.className =
            "model-id";

        id.textContent =
            model.id;


        info.appendChild(
            name
        );

        info.appendChild(
            id
        );


        row.appendChild(
            icon
        );

        row.appendChild(
            info
        );


        row.addEventListener(
            "click",
            () => {

                selectModel(
                    model
                );

                modelMenu.classList.remove(
                    "open"
                );
            }
        );


        fragment.appendChild(
            row
        );
    }


    modelList.appendChild(
        fragment
    );
}


// ============================================================
// MODEL SELECT
// ============================================================

function selectModel(model) {

    selectedModel =
        model;


    modelButtonName.textContent =
        model.name ||
        model.id;


    modelButtonIcon.innerHTML =
        "";


    const icon =
        makeModelIcon(
            model
        );


    modelButtonIcon.appendChild(
        icon
            .querySelector("img")
            ?.cloneNode(true)
            ||
            document.createElement("span")
    );


    localStorage.setItem(
        MODEL_STORAGE,
        model.id
    );
}


// ============================================================
// LOAD MODELS
// ============================================================

async function loadModels() {

    try {

        const response =
            await fetch(
                "/api/models",
                {
                    cache: "no-store"
                }
            );

        const data =
            await response.json();


        if (
            !response.ok ||
            !data.ok
        ) {

            throw new Error(
                data.error ||
                "Failed to load models"
            );
        }


        models =
            Array.isArray(data.models)
                ? data.models
                : [];


        renderModels();


        const saved =
            localStorage.getItem(
                MODEL_STORAGE
            );


        const savedModel =
            models.find(
                model =>
                    model.id === saved
            );


        if (savedModel) {

            selectModel(
                savedModel
            );

        } else if (models.length) {

            selectModel(
                models[0]
            );
        }

    } catch (error) {

        console.error(
            "Model loading failed:",
            error
        );

        modelButtonName.textContent =
            "Failed to load models";
    }
}


loadModels();


// ============================================================
// MODEL SEARCH
// ============================================================

modelSearch.addEventListener(
    "input",
    () => {

        renderModels(
            modelSearch.value
        );
    }
);


// ============================================================
// MODEL MENU
// ============================================================

modelButton.addEventListener(
    "click",
    () => {

        modelMenu.classList.toggle(
            "open"
        );


        if (
            modelMenu.classList.contains(
                "open"
            )
        ) {

            modelSearch.value =
                "";

            renderModels();

            setTimeout(
                () => modelSearch.focus(),
                20
            );
        }
    }
);


document.addEventListener(
    "click",
    event => {

        if (
            !modelMenu.contains(
                event.target
            ) &&
            !modelButton.contains(
                event.target
            )
        ) {

            modelMenu.classList.remove(
                "open"
            );
        }
    }
);


// ============================================================
// CHAT UI
// ============================================================

function addMessage(
    role,
    text
) {

    empty.style.display =
        "none";


    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        "message " +
        (
            role === "user"
                ? "message-user"
                : "message-ai"
        );


    const roleLabel =
        document.createElement(
            "div"
        );

    roleLabel.className =
        "message-role";

    roleLabel.textContent =
        role === "user"
            ? "You"
            : "Delta AI";


    const content =
        document.createElement(
            "div"
        );

    content.className =
        "message-content";

    content.textContent =
        text;


    wrapper.appendChild(
        roleLabel
    );

    wrapper.appendChild(
        content
    );


    chat.appendChild(
        wrapper
    );


    chat.scrollTop =
        chat.scrollHeight;
}


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage() {

    const text =
        prompt.value.trim();


    if (!text) {
        return;
    }


    if (!selectedModel) {

        addMessage(
            "ai",
            "Select an AI model first."
        );

        return;
    }


    const apiKey =
        localStorage.getItem(
            API_KEY_STORAGE
        );


    if (!apiKey) {

        addMessage(
            "ai",
            "Add your OpenRouter API key to local storage before sending a request."
        );

        return;
    }


    prompt.value =
        "";


    addMessage(
        "user",
        text
    );


    send.disabled =
        true;

    send.textContent =
        "Thinking...";


    try {

        const response =
            await fetch(
                "/ai-chat",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        apiKey,
                        model:
                            selectedModel.id,
                        prompt:
                            text
                    })
                }
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.ok
        ) {

            throw new Error(
                data.error ||
                "AI request failed"
            );
        }


        addMessage(
            "ai",
            data.response ||
            "No response returned."
        );


    } catch (error) {

        addMessage(
            "ai",
            `Request failed: ${error.message}`
        );

    } finally {

        send.disabled =
            false;

        send.textContent =
            "Send";
    }
}


send.addEventListener(
    "click",
    sendMessage
);


prompt.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);


// ============================================================
// DEV CONSOLE API
// ============================================================
//
// You can set the key from the browser console:
//
// localStorage.setItem(
//     "delta_ai_hub_openrouter_key",
//     "YOUR_KEY"
// )
//
// ============================================================

</script>

</body>

</html>`);
});


// ============================================================
// 404
// ============================================================

app.use(
    (req, res) => {

        res.status(404).json({
            ok: false,
            error: "Not found"
        });
    }
);


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "[Server]",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            ok: false,
            error:
                error.message ||
                "Internal server error"
        });
    }
);


// ============================================================
// START
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Delta AI Hub running on port ${PORT}`
        );

        console.log(
            "OpenRouter model catalog enabled."
        );

        console.log(
            "Provider-first icon resolution enabled."
        );

        console.log(
            "Stale Delta telemetry cleanup enabled."
        );
    }
);

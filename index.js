#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import express from "express";
import crypto from "crypto";

const BASE_URL = process.env.KRAVIONA_API_URL || "https://api.kraviona.com/api/v1";
const EMAIL = process.env.KRAVIONA_EMAIL;
const PASSWORD = process.env.KRAVIONA_PASSWORD;
const PORT = Number(process.env.PORT || 3000);
const SERVER_URL = process.env.SERVER_URL || "https://mcp-kraviona.onrender.com";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "kraviona-claude";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "kraviona-secret-2024";
const USE_SSE = process.env.USE_SSE === "true" || Boolean(process.env.RENDER) || Boolean(process.env.RAILWAY);

let authCookie = "";

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (authCookie) config.headers["Cookie"] = authCookie;
  return config;
});

async function ensureLoggedIn() {
  if (authCookie) return;
  if (!EMAIL || !PASSWORD) throw new Error("KRAVIONA_EMAIL and KRAVIONA_PASSWORD must be set");
  const res = await api.post("/login", { email: EMAIL, password: PASSWORD });
  const setCookie = res.headers["set-cookie"];
  if (setCookie) {
    authCookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  } else {
    throw new Error("Login failed — no cookie received");
  }
}

async function apiCall(method, endpoint, data = null, params = null) {
  await ensureLoggedIn();
  const res = await api({ method, url: endpoint, data, params });
  return res.data;
}

function createServer() {
  const server = new Server(
    { name: "kraviona-admin", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_dashboard",
        description: "Get Kraviona dashboard analytics",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_posts",
        description: "Get all blog posts",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number" },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "get_single_post",
        description: "Get a single blog post by slug",
        inputSchema: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string" } },
        },
      },
      {
        name: "create_post",
        description: "Create a new blog post",
        inputSchema: {
          type: "object",
          required: ["title", "content"],
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            slug: { type: "string" },
            excerpt: { type: "string" },
            status: { type: "string", enum: ["draft", "published"] },
          },
        },
      },
      {
        name: "get_leads",
        description: "Get leads",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number" },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "get_messages",
        description: "Get contact messages",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number" },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "get_categories",
        description: "Get blog categories",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_comments",
        description: "Get comments",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_team",
        description: "Get team members",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_users",
        description: "Get admin users",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      let result;
      switch (name) {
        case "get_dashboard":
          result = await apiCall("GET", "/analytics/dashboard");
          break;
        case "get_posts":
          result = await apiCall("GET", "/private/posts", null, args);
          break;
        case "get_single_post":
          result = await apiCall("GET", `/post/${args.slug}`);
          break;
        case "create_post":
          result = await apiCall("POST", "/create-post", args);
          break;
        case "get_leads":
          result = await apiCall("GET", "/leads", null, args);
          break;
        case "get_messages":
          result = await apiCall("GET", "/messages", null, args);
          break;
        case "get_categories":
          result = await apiCall("GET", "/categories/all");
          break;
        case "get_comments":
          result = await apiCall("GET", "/comments");
          break;
        case "get_team":
          result = await apiCall("GET", "/team");
          break;
        case "get_users":
          result = await apiCall("GET", "/users");
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

if (USE_SSE) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // ─── OAuth ───────────────────────────────────────────────────────────────────
  const authCodes = new Map();
  const accessTokens = new Map();

  // Discovery document
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: SERVER_URL,
      authorization_endpoint: `${SERVER_URL}/oauth/authorize`,
      token_endpoint: `${SERVER_URL}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
    });
  });

  // Dynamic client registration — Claude.ai yeh try karta hai pehle
  app.post("/oauth/register", (req, res) => {
    res.json({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      redirect_uris: req.body.redirect_uris || [],
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });

  // Authorize
  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state } = req.query;
    if (!redirect_uri) return res.status(400).send("Missing redirect_uri");

    const code = crypto.randomBytes(16).toString("hex");
    authCodes.set(code, { redirect_uri, created: Date.now() });
    setTimeout(() => authCodes.delete(code), 10 * 60 * 1000);

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    res.redirect(redirectUrl.toString());
  });

  // Token exchange
  app.post("/oauth/token", (req, res) => {
    const { code, grant_type, client_id } = req.body;

    if (client_id && client_id !== OAUTH_CLIENT_ID) {
      return res.status(401).json({ error: "invalid_client" });
    }

    if (grant_type !== "authorization_code") {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }

    if (!code || !authCodes.has(code)) {
      return res.status(400).json({ error: "invalid_or_expired_code" });
    }

    authCodes.delete(code);
    const token = crypto.randomBytes(32).toString("hex");
    accessTokens.set(token, { created: Date.now() });
    setTimeout(() => accessTokens.delete(token), 24 * 60 * 60 * 1000);

    res.json({ access_token: token, token_type: "bearer", expires_in: 86400 });
  });

  // Userinfo
  app.get("/oauth/userinfo", (_req, res) => {
    res.json({ sub: "kraviona-admin", name: "Kraviona Admin" });
  });

  // ─── Health ───────────────────────────────────────────────────────────────────
  app.get("/", (_req, res) => res.json({ status: "✅ Kraviona MCP Server running", transport: "sse" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // ─── SSE ─────────────────────────────────────────────────────────────────────
  const transports = {};

  app.get("/sse", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;

    // Absolute URL override
    res.write(`event: endpoint\ndata: ${SERVER_URL}/messages?sessionId=${sessionId}\n\n`);

    res.on("close", () => {
      delete transports[sessionId];
      console.log(`Session closed: ${sessionId}`);
    });

    const server = createServer();
    await server.connect(transport);
    console.log(`New SSE session: ${sessionId}`);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    if (!transport) {
      return res.status(400).json({ error: "No transport found for sessionId" });
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.log(`✅ Kraviona MCP SSE Server running on port ${PORT}`);
    console.log(`🔗 SSE: ${SERVER_URL}/sse`);
    console.log(`🔐 OAuth: ${SERVER_URL}/oauth/authorize`);
  });
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Kraviona MCP stdio Server running...");
}
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import express from "express";
import crypto from "crypto";

const BASE_URL = process.env.KRAVIONA_API_URL || "https://api.kraviona.com/api/v1";
const EMAIL    = process.env.KRAVIONA_EMAIL;
const PASSWORD = process.env.KRAVIONA_PASSWORD;
const PORT     = Number(process.env.PORT || 3000);
const SERVER_URL       = process.env.SERVER_URL       || "https://mcp-kraviona-production.up.railway.app";
const OAUTH_CLIENT_ID  = process.env.OAUTH_CLIENT_ID  || "kraviona-claude";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "kraviona-secret-2024";
const USE_SSE =
  process.env.USE_SSE === "true" ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.RAILWAY_ENVIRONMENT);

// ─── Auth ─────────────────────────────────────────────────────────────────────
let accessToken = "";
let tokenExpiry = 0;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers["Authorization"] = `Bearer ${accessToken}`;
  return cfg;
});

async function ensureLoggedIn() {
  if (accessToken && Date.now() < tokenExpiry - 5 * 60 * 1000) return;
  if (!EMAIL || !PASSWORD) throw new Error("KRAVIONA_EMAIL and KRAVIONA_PASSWORD must be set");
  console.log("Logging in to Kraviona API...");
  const res = await axios.post(`${BASE_URL}/mcp-login`, { identifier: EMAIL, password: PASSWORD });
  if (!res.data?.accessToken) throw new Error(`MCP login failed: ${JSON.stringify(res.data)}`);
  accessToken = res.data.accessToken;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  console.log("Kraviona API login successful");
}

async function apiCall(method, endpoint, data = null, params = null) {
  await ensureLoggedIn();
  const res = await api({ method, url: endpoint, data, params });
  return res.data;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────
const TOOLS = [

  // ── Analytics ──────────────────────────────────────────────────────────────
  {
    name: "get_dashboard",
    description: "Get Kraviona dashboard analytics — total posts, views, leads, messages, recent activity",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Posts ──────────────────────────────────────────────────────────────────
  {
    name: "get_posts",
    description: "Get all blog posts (published + drafts) with pagination. Use status filter to get only published or draft posts.",
    inputSchema: {
      type: "object",
      properties: {
        page:   { type: "number", description: "Page number (default 1)" },
        limit:  { type: "number", description: "Posts per page (default 20)" },
        status: { type: "string", enum: ["published", "draft"], description: "Filter by status" },
      },
    },
  },
  {
    name: "get_single_post",
    description: "Get full details of a single blog post by its slug",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: { slug: { type: "string", description: "Post slug e.g. what-is-mern-stack" } },
    },
  },
  {
    name: "create_post",
    description: "Create a new blog post with full SEO metadata, category, featured image, and content",
    inputSchema: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title:               { type: "string",  description: "Post title" },
        content:             { type: "string",  description: "HTML content of the post" },
        slug:                { type: "string",  description: "URL slug (auto-generated from title if omitted)" },
        excerpt:             { type: "string",  description: "Short description / meta description" },
        status:              { type: "string",  enum: ["draft", "published"], description: "Post status (default: draft)" },
        category:            { type: "string",  description: "Category slug e.g. technical-seo, ai-and-automation" },
        primaryTopicCluster: { type: "string",  description: "Primary topic cluster / pillar keyword for the post" },
        featuredImageUrl:    { type: "string",  description: "Featured image URL (from Unsplash or Cloudinary)" },
        featuredImageAlt:    { type: "string",  description: "Featured image alt text" },
        metaTitle:           { type: "string",  description: "SEO meta title (60 chars max)" },
        metaDescription:     { type: "string",  description: "SEO meta description (160 chars max)" },
        metaKeywords:        { type: "array",   items: { type: "string" }, description: "SEO keywords array" },
        contentSourceType:   { type: "string",  enum: ["Human", "AI"], description: "Content source type (default: Human)" },
        canonicalUrl:        { type: "string",  description: "Canonical URL if different from default" },
        ogTitle:             { type: "string",  description: "Open Graph title for social sharing" },
        ogDescription:       { type: "string",  description: "Open Graph description for social sharing" },
      },
    },
  },
  {
    name: "update_post",
    description: "Update an existing blog post by its ID — change title, content, status, SEO fields, category, image, etc.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug:                { type: "string",  description: "ID or slug of the post to update" },
        title:               { type: "string" },
        content:             { type: "string" },
        excerpt:             { type: "string" },
        status:              { type: "string",  enum: ["draft", "published"] },
        category:            { type: "string",  description: "Category slug" },
        primaryTopicCluster: { type: "string" },
        featuredImageUrl:    { type: "string" },
        featuredImageAlt:    { type: "string" },
        metaTitle:           { type: "string" },
        metaDescription:     { type: "string" },
        metaKeywords:        { type: "array",   items: { type: "string" } },
        contentSourceType:   { type: "string",  enum: ["Human", "AI"] },
        ogTitle:             { type: "string" },
        ogDescription:       { type: "string" },
      },
    },
  },
  {
    name: "delete_post",
    description: "Permanently delete a blog post by its slug",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "Slug of the post to delete" },
      },
    },
  },
  {
    name: "publish_post",
    description: "Publish a draft blog post (change status from draft to published)",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "ID or slug of the draft post to publish" },
      },
    },
  },
  {
    name: "unpublish_post",
    description: "Unpublish a post (change status from published back to draft)",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "ID or slug of the post to unpublish" },
      },
    },
  },

  // ── Categories ─────────────────────────────────────────────────────────────
  {
    name: "get_categories",
    description: "Get all blog categories with their post counts and metadata",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_category",
    description: "Create a new blog category with SEO metadata",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name:            { type: "string",  description: "Category display name" },
        slug:            { type: "string",  description: "URL slug (auto-generated if omitted)" },
        description:     { type: "string",  description: "Category description" },
        metaTitle:       { type: "string",  description: "SEO meta title" },
        metaDescription: { type: "string",  description: "SEO meta description" },
        ogTitle:         { type: "string",  description: "OG title for social sharing" },
        ogDescription:   { type: "string",  description: "OG description for social sharing" },
        imageUrl:        { type: "string",  description: "Category image URL" },
      },
    },
  },
  {
    name: "update_category",
    description: "Update an existing category by its slug",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug:            { type: "string",  description: "Slug of the category to update" },
        name:            { type: "string" },
        description:     { type: "string" },
        metaTitle:       { type: "string" },
        metaDescription: { type: "string" },
        ogTitle:         { type: "string" },
        ogDescription:   { type: "string" },
        imageUrl:        { type: "string" },
        status:          { type: "string",  enum: ["published", "draft"] },
      },
    },
  },
  {
    name: "delete_category",
    description: "Delete a blog category by its slug",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "Slug of the category to delete" },
      },
    },
  },

  // ── Comments ───────────────────────────────────────────────────────────────
  {
    name: "get_comments",
    description: "Get all blog comments (approved, pending, spam)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["approved", "pending", "spam"], description: "Filter by comment status" },
        page:   { type: "number" },
        limit:  { type: "number" },
      },
    },
  },
  {
    name: "update_comment_status",
    description: "Approve, reject, or mark a comment as spam",
    inputSchema: {
      type: "object",
      required: ["commentId", "status"],
      properties: {
        commentId: { type: "string",  description: "Comment ID" },
        status:    { type: "string",  enum: ["approved", "pending", "spam"], description: "New status" },
      },
    },
  },
  {
    name: "delete_comment",
    description: "Permanently delete a comment by its ID",
    inputSchema: {
      type: "object",
      required: ["commentId"],
      properties: {
        commentId: { type: "string", description: "Comment ID to delete" },
      },
    },
  },

  // ── Leads ──────────────────────────────────────────────────────────────────
  {
    name: "get_leads",
    description: "Get all CRM leads with pagination",
    inputSchema: {
      type: "object",
      properties: {
        page:   { type: "number" },
        limit:  { type: "number" },
        status: { type: "string", description: "Filter by lead status" },
      },
    },
  },
  {
    name: "get_single_lead",
    description: "Get full details of a single lead by its ID",
    inputSchema: {
      type: "object",
      required: ["leadId"],
      properties: {
        leadId: { type: "string", description: "Lead ID" },
      },
    },
  },
  {
    name: "update_lead_status",
    description: "Update the status of a lead (e.g. new → contacted → qualified → closed)",
    inputSchema: {
      type: "object",
      required: ["leadId", "status"],
      properties: {
        leadId: { type: "string" },
        status: { type: "string", description: "New status e.g. new, contacted, qualified, proposal, closed-won, closed-lost" },
        notes:  { type: "string", description: "Optional notes about the status change" },
      },
    },
  },
  {
    name: "delete_lead",
    description: "Delete a lead by its ID",
    inputSchema: {
      type: "object",
      required: ["leadId"],
      properties: {
        leadId: { type: "string", description: "Lead ID to delete" },
      },
    },
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  {
    name: "get_messages",
    description: "Get all contact form messages with pagination",
    inputSchema: {
      type: "object",
      properties: {
        page:   { type: "number" },
        limit:  { type: "number" },
        status: { type: "string", enum: ["unread", "read", "replied"], description: "Filter by message status" },
      },
    },
  },
  {
    name: "update_message_status",
    description: "Mark a contact message as read or replied",
    inputSchema: {
      type: "object",
      required: ["messageId", "status"],
      properties: {
        messageId: { type: "string" },
        status:    { type: "string", enum: ["read", "replied", "archived"] },
      },
    },
  },
  {
    name: "delete_message",
    description: "Delete a contact message by its ID",
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", description: "Message ID to delete" },
      },
    },
  },

  // ── Team ───────────────────────────────────────────────────────────────────
  {
    name: "get_team",
    description: "Get all team members",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_team_member",
    description: "Add a new team member to the site",
    inputSchema: {
      type: "object",
      required: ["name", "role"],
      properties: {
        name:        { type: "string",  description: "Full name" },
        role:        { type: "string",  description: "Job title / role e.g. Full Stack Developer" },
        bio:         { type: "string",  description: "Short bio" },
        email:       { type: "string",  description: "Email address" },
        avatarUrl:   { type: "string",  description: "Profile photo URL" },
        linkedinUrl: { type: "string",  description: "LinkedIn profile URL" },
        twitterUrl:  { type: "string",  description: "Twitter/X profile URL" },
        githubUrl:   { type: "string",  description: "GitHub profile URL" },
      },
    },
  },
  {
    name: "update_team_member",
    description: "Update an existing team member's details by their ID",
    inputSchema: {
      type: "object",
      required: ["memberId"],
      properties: {
        memberId:    { type: "string" },
        name:        { type: "string" },
        role:        { type: "string" },
        bio:         { type: "string" },
        email:       { type: "string" },
        avatarUrl:   { type: "string" },
        linkedinUrl: { type: "string" },
        twitterUrl:  { type: "string" },
        githubUrl:   { type: "string" },
      },
    },
  },
  {
    name: "delete_team_member",
    description: "Remove a team member by their ID",
    inputSchema: {
      type: "object",
      required: ["memberId"],
      properties: {
        memberId: { type: "string", description: "Team member ID to delete" },
      },
    },
  },

  // ── Users ──────────────────────────────────────────────────────────────────
  {
    name: "get_users",
    description: "Get all admin users",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_user",
    description: "Update an admin user's details or role",
    inputSchema: {
      type: "object",
      required: ["userId"],
      properties: {
        userId:   { type: "string" },
        name:     { type: "string" },
        email:    { type: "string" },
        role:     { type: "string", description: "User role e.g. admin, editor, author" },
        avatar:   { type: "string" },
        isActive: { type: "boolean" },
      },
    },
  },
  {
    name: "delete_user",
    description: "Delete an admin user by their ID",
    inputSchema: {
      type: "object",
      required: ["userId"],
      properties: {
        userId: { type: "string" },
      },
    },
  },

  // ── SEO & Site Settings ────────────────────────────────────────────────────
  {
    name: "get_site_settings",
    description: "Get global site settings — site name, logo, SEO defaults, social links, contact info",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_site_settings",
    description: "Update global site settings",
    inputSchema: {
      type: "object",
      properties: {
        siteName:           { type: "string" },
        siteTagline:        { type: "string" },
        siteDescription:    { type: "string" },
        siteUrl:            { type: "string" },
        logoUrl:            { type: "string" },
        faviconUrl:         { type: "string" },
        defaultMetaTitle:   { type: "string" },
        defaultMetaDesc:    { type: "string" },
        twitterHandle:      { type: "string" },
        linkedinUrl:        { type: "string" },
        facebookUrl:        { type: "string" },
        contactEmail:       { type: "string" },
        contactPhone:       { type: "string" },
        address:            { type: "string" },
        googleAnalyticsId:  { type: "string" },
      },
    },
  },

];

// ─── Tool Handler ─────────────────────────────────────────────────────────────
function buildPostPayload(args) {
  const payload = {};
  if (args.title)               payload.title               = args.title;
  if (args.content)             payload.content             = args.content;
  if (args.slug)                payload.slug                = args.slug;
  if (args.excerpt)             payload.excerpt             = args.excerpt;
  if (args.status)              payload.status              = args.status;
  if (args.category)            payload.category            = args.category;
  if (args.primaryTopicCluster) payload.primaryTopicCluster = args.primaryTopicCluster;
  if (args.metaTitle)           payload.metaTitle           = args.metaTitle;
  if (args.metaDescription)     payload.metaDescription     = args.metaDescription;
  if (args.metaKeywords)        payload.metaKeywords        = args.metaKeywords;
  if (args.contentSourceType)   payload.contentSourceType   = args.contentSourceType;
  if (args.canonicalUrl)        payload.canonicalUrl        = args.canonicalUrl;
  if (args.ogTitle)             payload.ogTitle             = args.ogTitle;
  if (args.ogDescription)       payload.ogDescription       = args.ogDescription;

  if (args.featuredImageUrl) {
    payload.featuredImage = {
      url:     args.featuredImageUrl,
      altText: args.featuredImageAlt || args.title || "",
    };
  }

  return payload;
}

async function handleTool(name, args = {}) {
  switch (name) {

    // Analytics
    case "get_dashboard":
      return await apiCall("GET", "/analytics/dashboard");

    // Posts
    case "get_posts":
      return await apiCall("GET", "/private/posts", null, args);

    case "get_single_post":
      return await apiCall("GET", `/post/${args.slug}`);

    case "create_post": {
      const payload = buildPostPayload(args);
      if (!payload.contentSourceType) payload.contentSourceType = "Human";
      if (!payload.status) payload.status = "draft";
      return await apiCall("POST", "/create-post", payload);
    }

    case "update_post": {
      const { slug, ...rest } = args;
      const payload = buildPostPayload(rest);
      return await apiCall("PATCH", `/post/${slug}`, payload);   // ✅ PATCH + /post/:id
    }

    case "delete_post":
      return await apiCall("DELETE", `/post/${args.slug}`);

    case "publish_post":
      return await apiCall("PATCH", `/post/${args.slug}`, { status: "published" });  // ✅ PATCH

    case "unpublish_post":
      return await apiCall("PATCH", `/post/${args.slug}`, { status: "draft" });      // ✅ PATCH

    // Categories
    case "get_categories":
      return await apiCall("GET", "/categories/all");

    case "create_category": {
      const { imageUrl, ...rest } = args;
      const payload = { ...rest };
      if (imageUrl) payload.image = imageUrl;
      return await apiCall("POST", "/create-category", payload);
    }

    case "update_category": {
      const { slug, imageUrl, ...rest } = args;
      const payload = { ...rest };
      if (imageUrl) payload.image = imageUrl;
      return await apiCall("PUT", `/category/${slug}`, payload);  // PUT is correct per routes
    }

    case "delete_category":
      return await apiCall("DELETE", `/category/${args.slug}`);

    // Comments
    case "get_comments":
      return await apiCall("GET", "/comments", null, args);

    case "update_comment_status":
      return await apiCall("PATCH", `/comments/${args.commentId}`, { status: args.status });  // ✅ PATCH + plural

    case "delete_comment":
      return await apiCall("DELETE", `/comments/${args.commentId}`);  // ✅ plural

    // Leads
    case "get_leads":
      return await apiCall("GET", "/leads", null, args);

    case "get_single_lead":
      return await apiCall("GET", `/leads/${args.leadId}`);  // ✅ plural

    case "update_lead_status":
      return await apiCall("PATCH", `/leads/${args.leadId}`, { status: args.status, notes: args.notes });  // ✅ PATCH + plural

    case "delete_lead":
      return await apiCall("DELETE", `/leads/${args.leadId}`);  // ✅ plural

    // Messages
    case "get_messages":
      return await apiCall("GET", "/messages", null, args);

    case "update_message_status":
      return await apiCall("PATCH", `/messages/${args.messageId}`, { status: args.status });  // ✅ PATCH + plural

    case "delete_message":
      return await apiCall("DELETE", `/messages/${args.messageId}`);  // ✅ plural

    // Team
    case "get_team":
      return await apiCall("GET", "/team");

    case "add_team_member": {
      const { avatarUrl, linkedinUrl, twitterUrl, githubUrl, ...rest } = args;
      const payload = { ...rest };
      if (avatarUrl)   payload.avatar    = avatarUrl;
      if (linkedinUrl) payload.linkedin  = linkedinUrl;
      if (twitterUrl)  payload.twitter   = twitterUrl;
      if (githubUrl)   payload.github    = githubUrl;
      return await apiCall("POST", "/team", payload);  // ✅ /team not /team/add
    }

    case "update_team_member": {
      const { memberId, avatarUrl, linkedinUrl, twitterUrl, githubUrl, ...rest } = args;
      const payload = { ...rest };
      if (avatarUrl)   payload.avatar    = avatarUrl;
      if (linkedinUrl) payload.linkedin  = linkedinUrl;
      if (twitterUrl)  payload.twitter   = twitterUrl;
      if (githubUrl)   payload.github    = githubUrl;
      return await apiCall("PATCH", `/team/${memberId}`, payload);  // ✅ PATCH
    }

    case "delete_team_member":
      return await apiCall("DELETE", `/team/${args.memberId}`);

    // Users
    case "get_users":
      return await apiCall("GET", "/users");

    case "update_user": {
      const { userId, ...payload } = args;
      return await apiCall("PATCH", `/users/${userId}`, payload);  // ✅ PATCH + plural
    }

    case "delete_user":
      return await apiCall("DELETE", `/users/${args.userId}`);  // ✅ plural

    // Site Settings
    case "get_site_settings":
      return await apiCall("GET", "/settings");

    case "update_site_settings":
      return await apiCall("PUT", "/settings", args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────
function createServer() {
  const server = new Server(
    { name: "kraviona-admin", version: "3.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await handleTool(name, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

// ─── HTTP / Stdio transport ────────────────────────────────────────────────────
if (USE_SSE) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // OAuth
  const authCodes    = new Map();
  const accessTokens = new Map();

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: SERVER_URL,
      authorization_endpoint: `${SERVER_URL}/oauth/authorize`,
      token_endpoint:         `${SERVER_URL}/oauth/token`,
      response_types_supported:      ["code"],
      grant_types_supported:         ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
    });
  });

  app.post("/oauth/register", (req, res) => {
    res.json({
      client_id:     OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      redirect_uris: req.body.redirect_uris || [],
      grant_types:   ["authorization_code"],
      response_types:["code"],
    });
  });

  app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state } = req.query;
    if (!redirect_uri) return res.status(400).send("Missing redirect_uri");
    const code = crypto.randomBytes(16).toString("hex");
    authCodes.set(code, { redirect_uri, created: Date.now() });
    setTimeout(() => authCodes.delete(code), 10 * 60 * 1000);
    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  app.post("/oauth/token", (req, res) => {
    const { code, grant_type, client_id } = req.body;
    if (client_id && client_id !== OAUTH_CLIENT_ID)
      return res.status(401).json({ error: "invalid_client" });
    if (grant_type !== "authorization_code")
      return res.status(400).json({ error: "unsupported_grant_type" });
    if (!code || !authCodes.has(code))
      return res.status(400).json({ error: "invalid_or_expired_code" });
    authCodes.delete(code);
    const token = crypto.randomBytes(32).toString("hex");
    accessTokens.set(token, { created: Date.now() });
    setTimeout(() => accessTokens.delete(token), 24 * 60 * 60 * 1000);
    res.json({ access_token: token, token_type: "bearer", expires_in: 86400 });
  });

  app.get("/oauth/userinfo", (_req, res) =>
    res.json({ sub: "kraviona-admin", name: "Kraviona Admin" })
  );

  app.get("/",       (_req, res) => res.json({ status: "Kraviona MCP Server running", version: "3.1.0", transport: "streamable-http", tools: TOOLS.length }));
  app.get("/health", (_req, res) => res.json({ status: "ok", tools: TOOLS.length }));

  // MCP Streamable HTTP
  const transports = new Map();

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport;
      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            console.log(`New MCP session: ${id}`);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
            console.log(`Session closed: ${transport.sessionId}`);
          }
        };
        const server = createServer();
        await server.connect(transport);
      }
      await transport.handleRequest(req, res, req.body || {});
    } catch (err) {
      console.error("MCP POST error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      if (!sessionId || !transports.has(sessionId))
        return res.status(400).json({ error: "Invalid or missing MCP-Session-Id" });
      await transports.get(sessionId).handleRequest(req, res);
    } catch (err) {
      console.error("MCP GET error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      if (!sessionId || !transports.has(sessionId))
        return res.status(400).json({ error: "Invalid or missing MCP-Session-Id" });
      await transports.get(sessionId).handleRequest(req, res);
      transports.delete(sessionId);
    } catch (err) {
      console.error("MCP DELETE error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  app.listen(PORT, () => {
    console.log(`✅ Kraviona MCP v3.1.0 — ${TOOLS.length} tools — port ${PORT}`);
    console.log(`   MCP endpoint: ${SERVER_URL}/mcp`);
  });

} else {
  const server   = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`✅ Kraviona MCP stdio v3.1.0 — ${TOOLS.length} tools`);
}
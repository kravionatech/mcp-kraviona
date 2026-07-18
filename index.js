#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BASE_URL = process.env.KRAVIONA_API_URL || "https://api.kraviona.com/api/v1";
const EMAIL    = process.env.KRAVIONA_EMAIL;
const PASSWORD = process.env.KRAVIONA_PASSWORD;

let authCookie = ""; // stores JWT cookie after login

// ─── AXIOS INSTANCE ─────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Attach cookie to every request
api.interceptors.request.use((config) => {
  if (authCookie) config.headers["Cookie"] = authCookie;
  return config;
});

// ─── AUTH HELPER ─────────────────────────────────────────────────────────────
async function ensureLoggedIn() {
  if (authCookie) return;
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

// ─── MCP SERVER ──────────────────────────────────────────────────────────────
const server = new Server(
  { name: "kraviona-admin", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [

    // ── DASHBOARD ──
    {
      name: "get_dashboard",
      description: "Get Kraviona dashboard analytics — traffic, leads, messages, posts summary",
      inputSchema: { type: "object", properties: {} },
    },

    // ── BLOGS / POSTS ──
    {
      name: "get_posts",
      description: "Get all blog posts (private — includes drafts)",
      inputSchema: {
        type: "object",
        properties: {
          page:  { type: "number", description: "Page number" },
          limit: { type: "number", description: "Posts per page" },
        },
      },
    },
    {
      name: "get_single_post",
      description: "Get a single blog post by slug",
      inputSchema: {
        type: "object",
        required: ["slug"],
        properties: {
          slug: { type: "string", description: "Post slug" },
        },
      },
    },
    {
      name: "create_post",
      description: "Create a new blog post on Kraviona",
      inputSchema: {
        type: "object",
        required: ["title", "content"],
        properties: {
          title:       { type: "string",  description: "Post title" },
          content:     { type: "string",  description: "Post content (HTML or markdown)" },
          slug:        { type: "string",  description: "URL slug (auto-generated if empty)" },
          excerpt:     { type: "string",  description: "Short description" },
          category:    { type: "string",  description: "Category ID" },
          tags:        { type: "array",   items: { type: "string" }, description: "Tags array" },
          status:      { type: "string",  enum: ["draft", "published"], description: "Post status" },
          featuredImage: { type: "string", description: "Image URL" },
          metaTitle:   { type: "string",  description: "SEO meta title" },
          metaDescription: { type: "string", description: "SEO meta description" },
        },
      },
    },
    {
      name: "update_post",
      description: "Update an existing blog post by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id:          { type: "string", description: "Post ID" },
          title:       { type: "string" },
          content:     { type: "string" },
          excerpt:     { type: "string" },
          status:      { type: "string", enum: ["draft", "published"] },
          metaTitle:   { type: "string" },
          metaDescription: { type: "string" },
          tags:        { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "delete_post",
      description: "Delete a blog post by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Post ID" },
        },
      },
    },

    // ── LEADS ──
    {
      name: "get_leads",
      description: "Get all leads/inquiries from Kraviona",
      inputSchema: {
        type: "object",
        properties: {
          page:   { type: "number" },
          limit:  { type: "number" },
          status: { type: "string", description: "Filter by status" },
        },
      },
    },
    {
      name: "get_lead",
      description: "Get a single lead by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
    },
    {
      name: "update_lead",
      description: "Update a lead — change status, add notes, etc.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id:     { type: "string" },
          status: { type: "string", description: "e.g. new, contacted, converted, closed" },
          notes:  { type: "string" },
          name:   { type: "string" },
          email:  { type: "string" },
          phone:  { type: "string" },
        },
      },
    },
    {
      name: "delete_lead",
      description: "Delete a lead by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── MESSAGES ──
    {
      name: "get_messages",
      description: "Get all contact messages from Kraviona",
      inputSchema: {
        type: "object",
        properties: {
          page:  { type: "number" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "get_message",
      description: "Get a single message by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    {
      name: "update_message",
      description: "Update a message — mark as read, replied, etc.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id:     { type: "string" },
          status: { type: "string", description: "e.g. unread, read, replied" },
          notes:  { type: "string" },
        },
      },
    },
    {
      name: "delete_message",
      description: "Delete a message by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── CATEGORIES ──
    {
      name: "get_categories",
      description: "Get all blog categories",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_category",
      description: "Create a new blog category",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name:        { type: "string" },
          slug:        { type: "string" },
          description: { type: "string" },
        },
      },
    },
    {
      name: "delete_category",
      description: "Delete a category by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── NEWSLETTER SUBSCRIBERS ──
    {
      name: "get_subscribers",
      description: "Get all newsletter subscribers",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "delete_subscriber",
      description: "Delete a newsletter subscriber by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── COMMENTS ──
    {
      name: "get_comments",
      description: "Get all blog comments for moderation",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "update_comment",
      description: "Approve or reject a comment",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id:     { type: "string" },
          status: { type: "string", description: "approved / rejected / pending" },
        },
      },
    },
    {
      name: "delete_comment",
      description: "Delete a comment by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── TEAM ──
    {
      name: "get_team",
      description: "Get all team members",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_team_member",
      description: "Add a new team member",
      inputSchema: {
        type: "object",
        required: ["name", "role"],
        properties: {
          name:  { type: "string" },
          role:  { type: "string" },
          bio:   { type: "string" },
          image: { type: "string" },
          social: { type: "object" },
        },
      },
    },
    {
      name: "update_team_member",
      description: "Update a team member by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id:    { type: "string" },
          name:  { type: "string" },
          role:  { type: "string" },
          bio:   { type: "string" },
        },
      },
    },
    {
      name: "delete_team_member",
      description: "Delete a team member by ID",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },

    // ── USERS ──
    {
      name: "get_users",
      description: "Get all admin users",
      inputSchema: { type: "object", properties: {} },
    },

  ],
}));

// ─── TOOL HANDLERS ───────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {

      // Dashboard
      case "get_dashboard":
        result = await apiCall("GET", "/analytics/dashboard");
        break;

      // Posts
      case "get_posts":
        result = await apiCall("GET", "/private/posts", null, args);
        break;
      case "get_single_post":
        result = await apiCall("GET", `/post/${args.slug}`);
        break;
      case "create_post":
        result = await apiCall("POST", "/create-post", args);
        break;
      case "update_post": {
        const { id, ...data } = args;
        result = await apiCall("PATCH", `/post/${id}`, data);
        break;
      }
      case "delete_post":
        result = await apiCall("DELETE", `/post/${args.id}`);
        break;

      // Leads
      case "get_leads":
        result = await apiCall("GET", "/leads", null, args);
        break;
      case "get_lead":
        result = await apiCall("GET", `/leads/${args.id}`);
        break;
      case "update_lead": {
        const { id, ...data } = args;
        result = await apiCall("PATCH", `/leads/${id}`, data);
        break;
      }
      case "delete_lead":
        result = await apiCall("DELETE", `/leads/${args.id}`);
        break;

      // Messages
      case "get_messages":
        result = await apiCall("GET", "/messages", null, args);
        break;
      case "get_message":
        result = await apiCall("GET", `/messages/${args.id}`);
        break;
      case "update_message": {
        const { id, ...data } = args;
        result = await apiCall("PATCH", `/messages/${id}`, data);
        break;
      }
      case "delete_message":
        result = await apiCall("DELETE", `/messages/${args.id}`);
        break;

      // Categories
      case "get_categories":
        result = await apiCall("GET", "/categories/all");
        break;
      case "create_category":
        result = await apiCall("POST", "/create-category", args);
        break;
      case "delete_category":
        result = await apiCall("DELETE", `/category/${args.id}`);
        break;

      // Newsletter
      case "get_subscribers":
        result = await apiCall("GET", "/newslatter");
        break;
      case "delete_subscriber":
        result = await apiCall("DELETE", `/newslatter/${args.id}`);
        break;

      // Comments
      case "get_comments":
        result = await apiCall("GET", "/comments");
        break;
      case "update_comment": {
        const { id, ...data } = args;
        result = await apiCall("PATCH", `/comments/${id}`, data);
        break;
      }
      case "delete_comment":
        result = await apiCall("DELETE", `/comments/${args.id}`);
        break;

      // Team
      case "get_team":
        result = await apiCall("GET", "/team");
        break;
      case "create_team_member":
        result = await apiCall("POST", "/team", args);
        break;
      case "update_team_member": {
        const { id, ...data } = args;
        result = await apiCall("PATCH", `/team/${id}`, data);
        break;
      }
      case "delete_team_member":
        result = await apiCall("DELETE", `/team/${args.id}`);
        break;

      // Users
      case "get_users":
        result = await apiCall("GET", "/users");
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };

  } catch (err) {
    const msg = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ─── START ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("✅ Kraviona MCP Server running...");

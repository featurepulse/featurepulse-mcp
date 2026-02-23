#!/usr/bin/env node
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const FEATUREPULSE_URL =
  process.env.FEATUREPULSE_URL || "https://featurepul.se";
const API_KEY = process.env.FEATUREPULSE_API_KEY;

if (!API_KEY) {
  console.error(
    "Error: FEATUREPULSE_API_KEY environment variable is required.\n" +
      "Get your API key from the FeaturePulse dashboard under Project Settings."
  );
  process.exit(1);
}

// ─── Project auto-detection ──────────────────────────────────────────────────

interface ProjectEntry {
  id: string;
  name: string;
}

/** Parse projects out of the "Multiple projects found" error message. */
function parseProjectsFromError(message: string): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  // Matches: Name With Spaces (uuid)
  const re = /([^,(]+?)\s+\(([0-9a-f-]{36})\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    projects.push({ name: m[1].trim(), id: m[2] });
  }
  return projects;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, "");
}

/** Try to find a project whose name matches the current repo directory name. */
function inferProjectId(projects: ProjectEntry[]): string | null {
  const repoName = normalize(path.basename(process.cwd()));
  for (const p of projects) {
    if (normalize(p.name) === repoName) return p.id;
  }
  // Partial match fallback
  for (const p of projects) {
    const n = normalize(p.name);
    if (repoName.includes(n) || n.includes(repoName)) return p.id;
  }
  return null;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function apiFetch(
  endpoint: string,
  params?: Record<string, string>,
  _retry = true
): Promise<any> {
  const url = new URL(`${FEATUREPULSE_URL}/api/mcp${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": API_KEY! },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const message = json?.error ?? `HTTP ${res.status}`;

    // Auto-detect project from repo name on multi-project errors
    if (_retry && res.status === 400 && message.includes("Multiple projects")) {
      const projects = parseProjectsFromError(message);
      const inferredId = inferProjectId(projects);
      if (inferredId) {
        return apiFetch(endpoint, { ...params, project_id: inferredId }, false);
      }
    }

    const err = new Error(message) as any;
    err.apiJson = json;
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const PROJECT_ID_PROP = {
  project_id: {
    type: "string",
    description:
      "Project UUID. Required if your API key has multiple projects. " +
      "Use list_projects to see available projects.",
  },
} as const;

const TOOLS: Tool[] = [
  {
    name: "list_projects",
    description:
      "List all projects accessible with your API key. Use this to find the project_id " +
      "needed for other tools when you have multiple projects.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_feature_requests",
    description:
      "List feature requests from FeaturePulse. Supports filtering by status and priority, " +
      "full-text search, and sorting. Each result includes MRR data (revenue at risk) and " +
      "vote breakdown so you can prioritize development by business impact.",
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_ID_PROP,
        status: {
          type: "string",
          enum: [
            "pending",
            "approved",
            "planned",
            "in_progress",
            "completed",
            "rejected",
          ],
          description: "Filter by status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Filter by priority",
        },
        sort_by: {
          type: "string",
          enum: ["vote_count", "mrr", "created_at"],
          description:
            "Sort order: vote_count (most votes first), mrr (highest revenue impact first), created_at (newest first). Default: vote_count",
        },
        q: {
          type: "string",
          description: "Search term to filter by title",
        },
        limit: {
          type: "number",
          description: "Max results to return (1–200, default 50)",
        },
        offset: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
    },
  },
  {
    name: "get_project_stats",
    description:
      "Get a high-level statistical overview of your FeaturePulse project: total requests, " +
      "votes, and MRR grouped by status and priority. Includes top-10 requests by votes and " +
      "by revenue impact (MRR). Use this before diving into individual requests to understand " +
      "the overall landscape.",
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_ID_PROP,
      },
    },
  },
  {
    name: "search_feedback",
    description:
      "Search feature requests by a text query. Returns the most relevant matching requests " +
      "with their vote counts and MRR. Useful for finding related feedback before opening a " +
      "new request or exploring a specific feature area.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        ...PROJECT_ID_PROP,
        q: {
          type: "string",
          description: "Search term",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
    },
  },
  {
    name: "analyze_feedback_by_group",
    description:
      "Analyze and group all feature requests by a chosen dimension (status or priority), " +
      "returning counts, total votes, and aggregated MRR for each group. Ideal for generating " +
      "summaries like 'how much revenue is waiting on planned features?' or 'what's the MRR " +
      "impact of unaddressed high-priority requests?'",
    inputSchema: {
      type: "object",
      required: ["group_by"],
      properties: {
        ...PROJECT_ID_PROP,
        group_by: {
          type: "string",
          enum: ["status", "priority"],
          description: "Dimension to group by",
        },
      },
    },
  },
  {
    name: "update_feature_status",
    description:
      "Update the status or priority of a feature request. Use this to move requests through " +
      "the workflow (e.g., pending → approved → in_progress → completed) or to set/change priority.",
    inputSchema: {
      type: "object",
      required: ["feature_request_id"],
      properties: {
        ...PROJECT_ID_PROP,
        feature_request_id: {
          type: "string",
          description: "UUID of the feature request to update",
        },
        status: {
          type: "string",
          enum: [
            "pending",
            "approved",
            "planned",
            "in_progress",
            "completed",
            "rejected",
          ],
          description: "New status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "New priority",
        },
        status_message: {
          type: "string",
          description:
            "Optional message shown to users explaining the status change",
        },
      },
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

function projectParam(args: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  if (args.project_id) params.project_id = String(args.project_id);
  return params;
}

async function handleListProjects() {
  try {
    const data = await apiFetch("/stats");
    return `## Your Project\n\n- **${data.project.name}** (ID: \`${data.project.id}\`)\n  - ${data.overview.total_feature_requests} feature requests, ${data.overview.total_votes} votes, $${data.overview.total_mrr.toFixed(2)}/mo MRR`;
  } catch (err: any) {
    // When the API key has multiple projects, the 400 error includes the project list
    if (err.status === 400 && err.apiJson?.error?.includes("Multiple projects")) {
      return `## Your Projects\n\n${err.message}\n\nPass a \`project_id\` to other tools to target a specific project.`;
    }
    return "Could not fetch projects. Make sure your API key is valid.";
  }
}

async function handleListFeatureRequests(args: Record<string, unknown>) {
  const params: Record<string, string> = { ...projectParam(args) };
  if (args.status) params.status = String(args.status);
  if (args.priority) params.priority = String(args.priority);
  if (args.sort_by) params.sort_by = String(args.sort_by);
  if (args.q) params.q = String(args.q);
  if (args.limit) params.limit = String(args.limit);
  if (args.offset) params.offset = String(args.offset);

  const data = await apiFetch("/feature-requests", params);
  return formatFeatureRequestList(data);
}

async function handleGetProjectStats(args: Record<string, unknown>) {
  const data = await apiFetch("/stats", projectParam(args));
  return formatStats(data);
}

async function handleSearchFeedback(args: Record<string, unknown>) {
  const params: Record<string, string> = {
    ...projectParam(args),
    q: String(args.q),
    limit: String(args.limit || 20),
  };
  const data = await apiFetch("/feature-requests", params);
  return formatFeatureRequestList(data);
}

async function handleAnalyzeFeedbackByGroup(args: Record<string, unknown>) {
  const data = await apiFetch("/stats", projectParam(args));
  const groupBy = String(args.group_by);

  const groups =
    groupBy === "status" ? data.by_status : data.by_priority;

  const lines: string[] = [
    `## Feature Requests Grouped by ${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}\n`,
  ];

  for (const [key, val] of Object.entries(
    groups as Record<string, { count: number; total_mrr: number }>
  )) {
    lines.push(
      `### ${key} (${val.count} request${val.count !== 1 ? "s" : ""})`
    );
    lines.push(`- Total MRR at stake: $${val.total_mrr.toFixed(2)}/mo\n`);
  }

  return lines.join("\n");
}

async function handleUpdateFeatureStatus(args: Record<string, unknown>) {
  const id = String(args.feature_request_id);
  const body: Record<string, unknown> = {};
  if (args.status) body.status = args.status;
  if (args.priority) body.priority = args.priority;
  if (args.status_message) body.status_message = args.status_message;

  const pidQuery = args.project_id ? `?project_id=${args.project_id}` : "";
  const url = `${FEATUREPULSE_URL}/api/mcp/feature-requests/${id}${pidQuery}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "x-api-key": API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update feature request: ${text}`);
  }

  const updated = await res.json();
  return (
    `Successfully updated feature request "${updated.title}".\n` +
    `Status: ${updated.status} | Priority: ${updated.priority}`
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatFeatureRequestList(data: {
  feature_requests: any[];
  total: number;
  project: { name: string };
}): string {
  const { feature_requests, total, project } = data;
  if (!feature_requests.length) {
    return "No feature requests found matching the given filters.";
  }

  const lines: string[] = [
    `## ${project.name} — Feature Requests (${feature_requests.length} of ${total} total)\n`,
  ];

  for (const fr of feature_requests) {
    lines.push(`### ${fr.title}`);
    lines.push(`- **ID**: ${fr.id}`);
    lines.push(`- **Status**: ${fr.status} | **Priority**: ${fr.priority}`);
    lines.push(
      `- **Votes**: ${fr.vote_count} (${fr.paying_customer_votes ?? "?"} paying, ${fr.free_votes ?? "?"} free)`
    );
    lines.push(`- **MRR impact**: $${(fr.total_mrr ?? 0).toFixed(2)}/mo`);
    if (fr.description) {
      const excerpt =
        fr.description.length > 200
          ? fr.description.slice(0, 200) + "…"
          : fr.description;
      lines.push(`- **Description**: ${excerpt}`);
    }
    if (fr.status_message) {
      lines.push(`- **Status note**: ${fr.status_message}`);
    }
    lines.push(`- **Created**: ${new Date(fr.created_at).toLocaleDateString()}\n`);
  }

  return lines.join("\n");
}

function formatStats(data: {
  project: { name: string };
  overview: { total_feature_requests: number; total_votes: number; total_mrr: number };
  by_status: Record<string, { count: number; total_mrr: number }>;
  by_priority: Record<string, { count: number; total_mrr: number }>;
  top_by_votes: any[];
  top_by_mrr: any[];
}): string {
  const { project, overview, by_status, by_priority, top_by_votes, top_by_mrr } = data;
  const lines: string[] = [
    `## ${project.name} — Feedback Overview\n`,
    `**Total requests**: ${overview.total_feature_requests}`,
    `**Total votes**: ${overview.total_votes}`,
    `**Total MRR at stake**: $${overview.total_mrr.toFixed(2)}/mo\n`,
    `### By Status`,
  ];

  for (const [status, val] of Object.entries(by_status)) {
    lines.push(
      `- **${status}**: ${val.count} request${val.count !== 1 ? "s" : ""} — $${val.total_mrr.toFixed(2)}/mo MRR`
    );
  }

  lines.push(`\n### By Priority`);
  for (const [priority, val] of Object.entries(by_priority)) {
    lines.push(
      `- **${priority}**: ${val.count} request${val.count !== 1 ? "s" : ""} — $${val.total_mrr.toFixed(2)}/mo MRR`
    );
  }

  lines.push(`\n### Top 10 by Votes`);
  for (const fr of top_by_votes) {
    lines.push(
      `- [${fr.status}/${fr.priority}] **${fr.title}** — ${fr.vote_count} votes`
    );
  }

  lines.push(`\n### Top 10 by MRR Impact`);
  for (const fr of top_by_mrr) {
    lines.push(
      `- [${fr.status}/${fr.priority}] **${fr.title}** — $${(fr.total_mrr ?? 0).toFixed(2)}/mo`
    );
  }

  return lines.join("\n");
}

// ─── MCP Server setup ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "featurepulse", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let text: string;

    switch (name) {
      case "list_projects":
        text = await handleListProjects();
        break;
      case "list_feature_requests":
        text = await handleListFeatureRequests(args as Record<string, unknown>);
        break;
      case "get_project_stats":
        text = await handleGetProjectStats(args as Record<string, unknown>);
        break;
      case "search_feedback":
        text = await handleSearchFeedback(args as Record<string, unknown>);
        break;
      case "analyze_feedback_by_group":
        text = await handleAnalyzeFeedbackByGroup(args as Record<string, unknown>);
        break;
      case "update_feature_status":
        text = await handleUpdateFeatureStatus(args as Record<string, unknown>);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text }] };
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

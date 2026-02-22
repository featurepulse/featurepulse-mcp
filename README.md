# FeaturePulse MCP Server

A Model Context Protocol (MCP) server for [FeaturePulse](https://featurepul.se) feedback management. Connect FeaturePulse to any MCP-compatible AI client to query feature requests, analyze MRR impact, and manage your product roadmap through natural language.

## Features

- **5 Tools** — Feature requests, stats, search, grouping, and status updates
- **MRR Data** — Every request includes revenue impact from paying customers
- **Search & Filter** — By status, priority, votes, or free-text search
- **Write Access** — Update feature request status and priority directly

## Prerequisites

- **Node.js** v18+
- **MCP Client** — Claude Code, Claude Desktop, Cursor, Windsurf, or any MCP-compatible client
- **FeaturePulse API Key** — Get one from your [FeaturePulse dashboard](https://featurepul.se/dashboard) under Project Settings

## Quick Start with Claude Code

The fastest way to start — run `npx` directly through Claude Code. No clone, no build.

### Step 1: Get Your API Key

1. Go to your [FeaturePulse dashboard](https://featurepul.se/dashboard)
2. Open **Project Settings**
3. Copy your **API Key**

### Step 2: Add the MCP Server

```bash
claude mcp add --transport stdio featurepulse \
  --scope user \
  --env FEATUREPULSE_API_KEY=<YOUR_API_KEY> \
  -- npx -y featurepulse-mcp
```

Replace `<YOUR_API_KEY>` with your API key.

### Step 3: Restart Claude Code

Quit and reopen Claude Code for the new server to load.

### Step 4: Verify

Ask Claude:

```
List the available FeaturePulse tools.
```

You should see 5 tools including `list_feature_requests` and `get_project_stats`.

## Setup with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "featurepulse": {
      "command": "npx",
      "args": ["-y", "featurepulse-mcp"],
      "env": {
        "FEATUREPULSE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Setup with Cursor / Windsurf

Add the same configuration to your editor's MCP settings file. Both Cursor and Windsurf support the MCP standard.

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| `list_feature_requests` | Read | Browse and filter feature requests with MRR data. Filter by status, priority; sort by votes, MRR, or date. |
| `get_project_stats` | Read | High-level overview — total requests, votes, MRR by status and priority. Top 10 by votes and MRR. |
| `search_feedback` | Read | Full-text search across feature request titles. |
| `analyze_feedback_by_group` | Read | Group requests by status or priority with aggregated counts and MRR. |
| `update_feature_status` | Write | Change the status, priority, or status message of a feature request. |

## Example Prompts

- "What are the top feature requests by MRR?"
- "Show me all pending high-priority requests"
- "How much revenue is behind planned features?"
- "Search for feedback about dark mode"
- "Mark the dark mode request as in_progress"
- "Give me a summary of feature requests grouped by status"

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `FEATUREPULSE_API_KEY` | Yes | Your project API key from the FeaturePulse dashboard |
| `FEATUREPULSE_URL` | No | API base URL (defaults to `https://featurepul.se`) |

## How It Works

```
AI Assistant  ←→  MCP Server (stdio/JSON-RPC)  ←→  FeaturePulse API (HTTPS)
```

The MCP server communicates over stdio using JSON-RPC. When your AI assistant calls a tool (e.g. `list_feature_requests`), the server makes authenticated requests to the FeaturePulse API and returns formatted results.

## Development

```bash
cd mcp-server
npm install
npm run dev    # Run with tsx (auto-reload)
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx featurepulse-mcp
```

## License

MIT

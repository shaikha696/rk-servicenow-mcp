# ServiceNow MCP Server

Connect any AI assistant — Claude, Cursor, or anything that speaks [MCP](https://modelcontextprotocol.io) — to your ServiceNow instance. Query records, create and update data, explore the data model, run server-side scripts, and debug, all through natural language.

Deploys to **Cloudflare Workers** in minutes. Supports multiple users, each bringing their own ServiceNow instance and credentials.

```
"How many P1 incidents are open right now?"
"Generate 15 demo incidents about network outages."
"Find the table that stores AI agent execution logs."
"What are the valid values for incident.state?"
"Show me the errors logged in the last 30 minutes."
```

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Deploy your own (5 minutes)](#deploy-your-own-5-minutes)
- [Connect an AI client](#connect-an-ai-client)
- [ServiceNow setup](#servicenow-setup)
- [Configuration reference](#configuration-reference)
- [Local development](#local-development)
- [Project structure](#project-structure)
- [Security](#security)

---

## Features

| Category | Tools |
|---|---|
| **Explore** | `search_tables`, `search_fields`, `get_table_schema`, `get_choices` — find the right table and fields without guessing |
| **Create & manage** | `create_record`, `batch_create_records`, `update_record`, `delete_record`, `update_incident`, `add_work_note` |
| **Query & analyze** | `query_table`, `get_record`, `aggregate_table`, `get_user`, `search_knowledge` |
| **Debug** | `query_logs` — read recent system logs by level, source, text, and time window |
| **Update sets** | `set_current_update_set`, `get_current_update_set` |
| **Develop** _(opt-in)_ | `execute_script`, `check_script_runner_status`, `reinstall_script_runner` — run server-side JavaScript synchronously |

- **Full Table API coverage** — works with every table (out-of-box or custom), not a fixed set.
- **Multi-user** — one deployment serves many people, each with their own instance and login.
- **Secure by default** — a shared bearer token gates the server; credentials are never stored.

---

## How it works

```
   AI client (Claude Desktop / Claude.ai / Cursor)
        │   Authorization: Bearer <token>
        │   X-ServiceNow-Instance / Username / Password
        ▼
   Cloudflare Worker  ──►  checks token  ──►  resolves credentials
        │                                          │
        ▼                                          ▼
   Durable Object (per session)  ── Basic Auth ──► ServiceNow REST API
```

Two independent layers:

1. **`MCP_AUTH_TOKEN`** — a shared secret that decides *who may use the Worker*.
2. **`X-ServiceNow-*` headers** — per-client *instance and credentials*. Each user points the same Worker at their own ServiceNow.

Credentials are resolved per request and passed to the session; nothing instance-specific is persisted.

---

## Deploy your own (5 minutes)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js installed.

### 1. Clone and install
```bash
git clone https://github.com/ciphervinci/rk-servicenow-mcp.git
cd rk-servicenow-mcp
npm install
```

### 2. Log in to Cloudflare
```bash
npx wrangler login
```

### 3. Set your access token
This is the shared password clients must send. Generate a strong one:
```bash
openssl rand -hex 32
```
Store it as an encrypted secret (never commit it):
```bash
npx wrangler secret put MCP_AUTH_TOKEN
# paste the value when prompted
```

### 4. Deploy
```bash
npm run deploy
```
You'll get a URL like `https://rk-servicenow-mcp.<your-subdomain>.workers.dev`.

### 5. Verify
```bash
curl https://rk-servicenow-mcp.<your-subdomain>.workers.dev/health
```
Returns server status and the tool list. That's it — your server is live.

> **Deploying from the Cloudflare dashboard (Git integration) instead of the CLI?**
> Under **Settings → Build**, set the build command to `bun add ai@5.0.78` and the deploy command to `npx wrangler deploy`. This resolves a bundling issue with a dependency. Everything else works the same.

---

## Connect an AI client

Each user supplies their own ServiceNow instance and credentials as headers, plus the shared token.

### Headers

| Header | Required | Example |
|---|---|---|
| `Authorization` | ✅ | `Bearer <your-MCP_AUTH_TOKEN>` |
| `X-ServiceNow-Instance` | ✅ | `https://devXXXXX.service-now.com` |
| `X-ServiceNow-Username` | ✅ | `admin` |
| `X-ServiceNow-Password` | ✅ | `your-password` |
| `X-ServiceNow-Script-Execution` | optional | `true` to enable `execute_script` |

### Claude Desktop

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://rk-servicenow-mcp.<your-subdomain>.workers.dev/sse",
        "--header", "Authorization:Bearer <your-token>",
        "--header", "X-ServiceNow-Instance:https://devXXXXX.service-now.com",
        "--header", "X-ServiceNow-Username:admin",
        "--header", "X-ServiceNow-Password:your-password",
        "--header", "X-ServiceNow-Script-Execution:true"
      ]
    }
  }
}
```
Restart Claude Desktop. The tools appear in the connector menu.

### Claude.ai (web)

**Settings → Connectors → Add custom connector.** Use the `/mcp` endpoint:
```
https://rk-servicenow-mcp.<your-subdomain>.workers.dev/mcp
```
Add the `Authorization` and `X-ServiceNow-*` headers in the connector's header fields.

### Cursor

Add to `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "servicenow": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://rk-servicenow-mcp.<your-subdomain>.workers.dev/sse",
        "--header", "Authorization:Bearer <your-token>",
        "--header", "X-ServiceNow-Instance:https://devXXXXX.service-now.com",
        "--header", "X-ServiceNow-Username:admin",
        "--header", "X-ServiceNow-Password:your-password"
      ]
    }
  }
}
```

### Any other MCP client

Point it at the `/mcp` endpoint (Streamable HTTP) or `/sse` endpoint (SSE) and send the same headers. If the client can't send custom headers, use `mcp-remote` as a bridge with `--header` flags as shown above.

---

## ServiceNow setup

Create a dedicated service-account user — don't reuse a personal admin login. Grant only the roles you need:

| What you'll do | Roles |
|---|---|
| Read tables | `snc_read_only` or table ACLs |
| ITSM read/write (incident, change, problem) | `itil` |
| Knowledge search | `knowledge` |
| Explore metadata & read logs | read on `sys_dictionary`, `sys_db_object`, `sys_choice`, `syslog` |
| Update sets | write on `sys_user_preference` |
| `execute_script` | `admin` |

> Tip: a free [ServiceNow Developer Instance](https://developer.servicenow.com/) (PDI) is perfect for trying this out.

---

## Configuration reference

Set credentials as **secrets** (encrypted, survive redeploys) rather than plaintext vars:

```bash
npx wrangler secret put MCP_AUTH_TOKEN        # required — shared access token
npx wrangler secret put SERVICENOW_USERNAME   # optional — default username
npx wrangler secret put SERVICENOW_PASSWORD   # optional — default password
```

Non-sensitive defaults live in `wrangler.jsonc` under `vars`:

| Variable | Purpose |
|---|---|
| `SERVICENOW_INSTANCE_URL` | Default instance if a client sends no `X-ServiceNow-Instance` header |
| `ENABLE_SCRIPT_EXECUTION` | Default for script execution (`"true"`/`"false"`) when no header is sent |

In **multi-user mode**, leave the ServiceNow defaults empty — every client supplies its own via headers. In **single-user mode**, set them and clients can connect with just the `Authorization` header.

---

## Local development

Create `.dev.vars` (gitignored):
```
MCP_AUTH_TOKEN=dev-token
SERVICENOW_INSTANCE_URL=https://devXXXXX.service-now.com
SERVICENOW_USERNAME=admin
SERVICENOW_PASSWORD=your-password
ENABLE_SCRIPT_EXECUTION=true
```
Run:
```bash
npm run dev   # http://localhost:8787
```
Point your client at `http://localhost:8787/sse` (via `mcp-remote`) to test locally.

---

## execute_script

When enabled, the server installs a small Scripted REST API on your instance on first use (`sys_ws_definition` + `sys_ws_operation`). After that, scripts run synchronously — typically sub-second. Wrap return values with `return JSON.stringify(...)`:

```javascript
var gr = new GlideRecord('incident');
gr.addEncodedQuery('sys_created_onONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()');
gr.query();
var n = 0;
while (gr.next()) { gr.urgency = 1; gr.update(); n++; }
return JSON.stringify({ updated: n });
```

Enable per session with the `X-ServiceNow-Script-Execution: true` header. Requires `admin` on the instance.

---

## Project structure

```
src/
├── index.ts        # Worker: auth, credential resolution, routing
├── mcp-agent.ts    # Durable Object agent; receives credentials per session
├── sn-client.ts    # REST client, types, helpers
├── ai-stub.js      # Build shim for a dependency
└── tools/          # One file per tool group
```

**Add a tool:** create `src/tools/x.ts` exporting `registerXTools(server, props)`, call it in `mcp-agent.ts`, add the name to `registeredToolNames()`. Use `snFetch`, `ok()`, and `fail()` from `sn-client.ts`.

**Endpoints:** `/mcp` (Streamable HTTP), `/sse` (SSE for `mcp-remote`), `/health` (status, no auth).

---

## Security

- **Always set `MCP_AUTH_TOKEN`.** An empty token disables authentication and exposes every tool — including script execution — to anyone with the URL.
- Store the token and passwords as **secrets**, never as plaintext `vars` (Git-based deploys overwrite vars).
- The service account's ServiceNow roles define what the server can do. Use least privilege.
- For higher assurance, put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) in front of the Worker.

---

## License

MIT

Built by [Rishikesh](https://github.com/ciphervinci) · [Medium](https://medium.com/@rkesh0504)

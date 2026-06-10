import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import {
	type CredentialHeaders,
	type Env,
	extractCredentialHeaders,
	resolveCredentials,
} from "./sn-client";
import { registerAggregateTools } from "./tools/aggregate";
import { registerDebugTools } from "./tools/debug";
import { registerExploreTools } from "./tools/explore";
import { registerIncidentTools } from "./tools/incidents";
import { registerKnowledgeTools } from "./tools/knowledge";
import { registerSchemaTools } from "./tools/schema";
import { registerScriptTools } from "./tools/scripts";
import { registerTableTools } from "./tools/table";
import { registerUpdateSetTools } from "./tools/update_sets";
import { registerUserTools } from "./tools/users";

/**
 * ServiceNow MCP agent.
 *
 * Multi-tenant credential flow:
 *   1. Worker fetch handler validates the bearer token (MCP_AUTH_TOKEN).
 *   2. Client supplies X-ServiceNow-{Instance,Username,Password,Script-Execution}
 *      headers on every request.
 *   3. Our fetch() override captures those headers into _credHeaders BEFORE
 *      calling super.fetch(), which internally triggers init().
 *   4. init() calls resolveCredentials() so tools get the per-request
 *      credentials rather than the static env vars.
 *
 * Single-user fallback: if no credential headers are present, init() falls
 * back to the Worker env vars (SERVICENOW_INSTANCE_URL, etc.) so existing
 * single-instance deployments keep working unchanged.
 *
 * Hibernation safety: Cloudflare hibernates idle DO instances. On every
 * wake-up a new HTTP request arrives (which triggers our fetch() override
 * before init() re-runs), so _credHeaders is always refreshed.
 */
export class ServiceNowMCP extends McpAgent {
	server = new McpServer({
		name: "ServiceNow MCP Server",
		version: "1.0.0",
	});

	/**
	 * Per-session credential headers. Set by the fetch() override on every
	 * request, before super.fetch() triggers init(). Not stored in DO state —
	 * refreshed from the triggering HTTP request on every DO wake-up.
	 */
	private _credHeaders: CredentialHeaders = {};

	/**
	 * Override the DO fetch handler to capture credential headers before
	 * super.fetch() internally calls onStart() → init().
	 *
	 * The DO lifecycle for an HTTP-triggered wake:
	 *   incoming request → this.fetch() → super.fetch() → onStart() → init()
	 * Setting _credHeaders at the top of this method guarantees init() sees
	 * them when it calls resolveCredentials().
	 */
	// @ts-ignore — DO fetch signature varies by SDK version; the override is safe
	async fetch(request: Request, ...rest: unknown[]): Promise<Response> {
		this._credHeaders = extractCredentialHeaders(request);
		// @ts-ignore
		return super.fetch(request, ...rest);
	}

	async init() {
		// Merge per-request header credentials on top of env var defaults.
		const env = resolveCredentials(
			this.env as Env,
			this._credHeaders,
		);

		registerTableTools(this.server, env);
		registerIncidentTools(this.server, env);
		registerUserTools(this.server, env);
		registerSchemaTools(this.server, env);
		registerExploreTools(this.server, env);
		registerAggregateTools(this.server, env);
		registerKnowledgeTools(this.server, env);
		registerUpdateSetTools(this.server, env);
		registerDebugTools(this.server, env);

		if (env.ENABLE_SCRIPT_EXECUTION === "true") {
			registerScriptTools(this.server, env);
		}
	}
}

/** Tool names registered for /health visibility. */
export function registeredToolNames(env: Env): string[] {
	const base = [
		"query_table",
		"get_record",
		"create_record",
		"update_record",
		"delete_record",
		"batch_create_records",
		"update_incident",
		"add_work_note",
		"get_user",
		"get_table_schema",
		"search_tables",
		"search_fields",
		"get_choices",
		"aggregate_table",
		"search_knowledge",
		"set_current_update_set",
		"get_current_update_set",
		"query_logs",
	];
	if (env.ENABLE_SCRIPT_EXECUTION === "true") {
		base.push(
			"execute_script",
			"check_script_runner_status",
			"reinstall_script_runner",
		);
	}
	return base;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Env, SNProps } from "./sn-client";
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
 * Credentials arrive via `props`, resolved in the Worker fetch handler (see
 * src/index.ts → resolveProps) where request headers are reliably available.
 * The SDK persists props to Durable Object storage and exposes them as
 * this.props, surviving hibernation and available before any tool call.
 *
 * This avoids cloudflare/agents#660, where the SSE transport drops request
 * headers before they reach the Durable Object.
 */
export class ServiceNowMCP extends McpAgent<Env, unknown, SNProps> {
	server = new McpServer({
		name: "ServiceNow MCP Server",
		version: "1.0.0",
	});

	async init() {
		// props are the resolved per-session credentials.
		const p = this.props as SNProps;

		registerTableTools(this.server, p);
		registerIncidentTools(this.server, p);
		registerUserTools(this.server, p);
		registerSchemaTools(this.server, p);
		registerExploreTools(this.server, p);
		registerAggregateTools(this.server, p);
		registerKnowledgeTools(this.server, p);
		registerUpdateSetTools(this.server, p);
		registerDebugTools(this.server, p);

		if (p.scriptExecution) {
			registerScriptTools(this.server, p);
		}
	}
}

/** Tool names for /health visibility. script_execution reflects the env default. */
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
		"execute_script (if enabled per-session)",
		"check_script_runner_status (if enabled per-session)",
		"reinstall_script_runner (if enabled per-session)",
	];
	return base;
}

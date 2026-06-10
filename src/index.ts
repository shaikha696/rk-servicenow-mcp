import { ServiceNowMCP, registeredToolNames } from "./mcp-agent";
import type { Env } from "./sn-client";

export { ServiceNowMCP };

/**
 * Validate the incoming request's bearer token against MCP_AUTH_TOKEN.
 *
 * If MCP_AUTH_TOKEN is empty or unset → bypass auth (single-user / backward-
 * compat mode). This means existing deployments with no token set keep working
 * without any config change.
 *
 * If MCP_AUTH_TOKEN is set → require "Authorization: Bearer <token>" and
 * reject everything else with 401.
 */
function isAuthorized(request: Request, env: Env): boolean {
	if (!env.MCP_AUTH_TOKEN) return true; // auth disabled
	const auth = request.headers.get("Authorization");
	if (!auth?.startsWith("Bearer ")) return false;
	return auth.slice(7) === env.MCP_AUTH_TOKEN;
}

function unauthorizedResponse(): Response {
	return new Response(
		JSON.stringify({
			error: "Unauthorized",
			message:
				"Provide a valid Bearer token in the Authorization header. " +
				"See README for client configuration examples.",
		}),
		{
			status: 401,
			headers: {
				"Content-Type": "application/json",
				"WWW-Authenticate": 'Bearer realm="ServiceNow MCP Server"',
			},
		},
	);
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Health check: no auth required, useful for uptime monitors.
		if (url.pathname === "/health") {
			return new Response(
				JSON.stringify(
					{
						status: "ok",
						service: "ServiceNow MCP Server",
						auth_enabled: !!env.MCP_AUTH_TOKEN,
						multi_tenant:
							"Pass X-ServiceNow-Instance, X-ServiceNow-Username, " +
							"X-ServiceNow-Password, X-ServiceNow-Script-Execution headers " +
							"to use per-client credentials instead of env vars.",
						tools: registeredToolNames(env),
					},
					null,
					2,
				),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		// All MCP endpoints require auth when a token is configured.
		if (!isAuthorized(request, env)) {
			return unauthorizedResponse();
		}

		// Streamable HTTP transport (modern MCP clients, Claude.ai).
		if (url.pathname === "/mcp") {
			return ServiceNowMCP.serve("/mcp", { env }).fetch(
				request,
				env,
				ctx,
			);
		}

		// SSE transport (mcp-remote bridge, Claude Desktop).
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return ServiceNowMCP.serveSSE("/sse", { env }).fetch(
				request,
				env,
				ctx,
			);
		}

		return new Response("Not found", { status: 404 });
	},
};

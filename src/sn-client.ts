/**
 * ServiceNow REST client + shared helpers.
 *
 * Multi-tenant credential flow:
 *   - The Worker fetch handler reads X-ServiceNow-* headers (reliable there),
 *     falls back to env vars, and passes the result to the agent as `props`.
 *   - Tools receive a resolved SNProps object, NOT the raw Env.
 *
 * Why not read headers inside the Durable Object: the agents SDK's SSE
 * transport drops request headers before they reach the DO (cloudflare/agents
 * #660). Resolving in the Worker handler and passing via props is the
 * hibernation-safe path.
 */

export interface Env {
	SERVICENOW_INSTANCE_URL: string;
	SERVICENOW_USERNAME: string;
	SERVICENOW_PASSWORD: string;
	/** "true" to register the execute_script tool (env-var default). */
	ENABLE_SCRIPT_EXECUTION?: string;
	/** Shared bearer token. Empty/unset = auth bypassed (single-user mode). */
	MCP_AUTH_TOKEN?: string;
}

/**
 * Resolved per-session credentials, passed to the agent as `props`.
 * This is what tools actually use to talk to ServiceNow.
 */
export interface SNProps {
	instanceUrl: string;
	username: string;
	password: string;
	scriptExecution: boolean;
	[key: string]: unknown; // index signature required by the SDK props type
}

/** Per-request credential headers extracted from an incoming request. */
export interface CredentialHeaders {
	instanceUrl?: string | null;
	username?: string | null;
	password?: string | null;
	scriptExecution?: string | null;
}

/** Extract ServiceNow credential headers from an incoming request. */
export function extractCredentialHeaders(req: Request): CredentialHeaders {
	return {
		instanceUrl: req.headers.get("X-ServiceNow-Instance"),
		username: req.headers.get("X-ServiceNow-Username"),
		password: req.headers.get("X-ServiceNow-Password"),
		scriptExecution: req.headers.get("X-ServiceNow-Script-Execution"),
	};
}

export type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

function authHeader(p: SNProps): string {
	return `Basic ${btoa(`${p.username}:${p.password}`)}`;
}

function instanceBase(p: SNProps): string {
	return (p.instanceUrl || "").replace(/\/$/, "");
}

/**
 * Wrapper around fetch() with auth, JSON handling, and error normalization.
 * Throws on non-2xx with a message including the ServiceNow error detail.
 * Operates on resolved SNProps (instance URL + credentials).
 */
export async function snFetch(
	p: SNProps,
	path: string,
	init: RequestInit = {},
): Promise<any> {
	if (!p.instanceUrl) {
		throw new Error(
			"No ServiceNow instance configured. Pass X-ServiceNow-Instance header " +
				"or set SERVICENOW_INSTANCE_URL env var.",
		);
	}
	const url = `${instanceBase(p)}${path}`;
	const headers: Record<string, string> = {
		Authorization: authHeader(p),
		Accept: "application/json",
		...((init.headers as Record<string, string>) || {}),
	};
	if (init.body && !headers["Content-Type"]) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url, { ...init, headers });
	const text = await res.text();
	let body: any;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		body = { raw: text };
	}
	if (!res.ok) {
		const errMsg =
			body?.error?.message ||
			body?.error?.detail ||
			body?.message ||
			res.statusText;
		throw new Error(
			`ServiceNow ${res.status} ${res.statusText} on ${path}: ${errMsg}`,
		);
	}
	return body;
}

export function ok(payload: unknown): ToolResult {
	return {
		content: [
			{
				type: "text",
				text:
					typeof payload === "string"
						? payload
						: JSON.stringify(payload, null, 2),
			},
		],
	};
}

export function fail(err: unknown): ToolResult {
	const msg = err instanceof Error ? err.message : String(err);
	return {
		content: [{ type: "text", text: `Error: ${msg}` }],
		isError: true,
	};
}

/**
 * Build the standard Table API / Aggregate API query string from common args.
 * Order is expressed by appending ^ORDERBY<field> or ^ORDERBYDESC<field> to
 * sysparm_query — there is NO sysparm_order_by parameter on the Table API.
 */
export function buildReadParams(opts: {
	sysparm_query?: string;
	sysparm_fields?: string;
	sysparm_limit?: number;
	sysparm_offset?: number;
	sysparm_display_value?: "true" | "false" | "all";
	sysparm_exclude_reference_link?: boolean;
}): URLSearchParams {
	const p = new URLSearchParams();
	if (opts.sysparm_query) p.append("sysparm_query", opts.sysparm_query);
	if (opts.sysparm_fields) p.append("sysparm_fields", opts.sysparm_fields);
	if (opts.sysparm_limit !== undefined)
		p.append("sysparm_limit", String(opts.sysparm_limit));
	if (opts.sysparm_offset !== undefined)
		p.append("sysparm_offset", String(opts.sysparm_offset));
	if (opts.sysparm_display_value)
		p.append("sysparm_display_value", opts.sysparm_display_value);
	if (opts.sysparm_exclude_reference_link !== undefined)
		p.append(
			"sysparm_exclude_reference_link",
			String(opts.sysparm_exclude_reference_link),
		);
	return p;
}

/** ServiceNow GlideDateTime format: "YYYY-MM-DD HH:MM:SS" in UTC. */
export function toGlideDateTime(d: Date): string {
	return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

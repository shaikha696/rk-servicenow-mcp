/**
 * ServiceNow REST client + shared helpers.
 *
 * Multi-tenant mode: clients pass X-ServiceNow-* headers per-request.
 * Single-user mode: credentials live in Worker env vars / secrets (wrangler.jsonc).
 * Both modes coexist — headers take priority over env vars.
 */

export interface Env {
	SERVICENOW_INSTANCE_URL: string;
	SERVICENOW_USERNAME: string;
	SERVICENOW_PASSWORD: string;
	/** If exactly "true", the execute_script tool is registered. */
	ENABLE_SCRIPT_EXECUTION?: string;
	/**
	 * Shared bearer token required in Authorization header.
	 * If empty/unset, auth is bypassed (backward-compat single-user mode).
	 * Set via: wrangler secret put MCP_AUTH_TOKEN
	 */
	MCP_AUTH_TOKEN?: string;
}

/**
 * Per-request credentials extracted from HTTP headers.
 * These override env vars when present, enabling multi-tenant usage.
 */
export interface CredentialHeaders {
	instanceUrl?: string | null;
	username?: string | null;
	password?: string | null;
	scriptExecution?: string | null;
}

/**
 * Merge per-request credential headers on top of env vars.
 * Headers win; env vars are the fallback.
 */
export function resolveCredentials(env: Env, h: CredentialHeaders): Env {
	return {
		...env,
		SERVICENOW_INSTANCE_URL: (
			h.instanceUrl ||
			env.SERVICENOW_INSTANCE_URL ||
			""
		).replace(/\/$/, ""),
		SERVICENOW_USERNAME: h.username || env.SERVICENOW_USERNAME || "",
		SERVICENOW_PASSWORD: h.password || env.SERVICENOW_PASSWORD || "",
		ENABLE_SCRIPT_EXECUTION:
			h.scriptExecution ?? env.ENABLE_SCRIPT_EXECUTION,
	};
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

function authHeader(env: Env): string {
	return `Basic ${btoa(`${env.SERVICENOW_USERNAME}:${env.SERVICENOW_PASSWORD}`)}`;
}

function instanceBase(env: Env): string {
	return env.SERVICENOW_INSTANCE_URL.replace(/\/$/, "");
}

/**
 * Wrapper around fetch() with auth, JSON handling, and error normalization.
 * Throws on non-2xx with a message including the ServiceNow error detail.
 */
export async function snFetch(
	env: Env,
	path: string,
	init: RequestInit = {},
): Promise<any> {
	const url = `${instanceBase(env)}${path}`;
	const headers: Record<string, string> = {
		Authorization: authHeader(env),
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

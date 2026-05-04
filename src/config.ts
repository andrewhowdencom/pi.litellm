import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ModelOverrides {
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	contextWindow?: number;
	maxTokens?: number;
}

export interface LiteLLMConfig {
	baseUrl: string;
	apiKey?: string;
	modelOverrides?: Record<string, ModelOverrides>;
}

function normalizeBaseUrl(raw: string): string {
	let url = raw.trim();
	if (url.endsWith("/")) {
		url = url.slice(0, -1);
	}
	if (!url.endsWith("/v1")) {
		url = `${url}/v1`;
	}
	return url;
}

function validateUrl(url: string): void {
	try {
		new URL(url);
	} catch {
		throw new Error(`Invalid LITELLM_BASE_URL: "${url}" is not a valid URL`);
	}
}

function loadConfigFile(deps?: {
	readFile?: (path: string, encoding: string) => string;
	cwd?: () => string;
}): Record<string, ModelOverrides> | undefined {
	const readFile = deps?.readFile ?? readFileSync;
	const cwd = deps?.cwd ?? process.cwd;
	const configPath = resolve(cwd(), ".pi", "litellm.json");
	try {
		const content = readFile(configPath, "utf-8");
		const parsed = JSON.parse(content) as {
			modelOverrides?: Record<string, ModelOverrides>;
		};
		return parsed.modelOverrides;
	} catch (err) {
		if (err instanceof Error && (err as { code?: unknown }).code === "ENOENT") {
			return undefined;
		}
		throw new Error(
			`Failed to parse .pi/litellm.json: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export function resolveConfig(deps?: {
	env?: NodeJS.ProcessEnv;
	readFile?: (path: string, encoding: string) => string;
	cwd?: () => string;
}): LiteLLMConfig {
	const env = deps?.env ?? process.env;
	const baseUrlRaw = env.LITELLM_BASE_URL;
	if (!baseUrlRaw) {
		throw new Error(
			"LITELLM_BASE_URL environment variable is required. " +
				"Set it to your LiteLLM proxy URL, e.g. http://localhost:4000",
		);
	}

	const baseUrl = normalizeBaseUrl(baseUrlRaw);
	validateUrl(baseUrl);

	const apiKey = env.LITELLM_API_KEY;
	const modelOverrides = loadConfigFile(deps);

	return {
		baseUrl,
		apiKey,
		modelOverrides,
	};
}

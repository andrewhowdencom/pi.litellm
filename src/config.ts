import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

const REPO_KEY = "github.com/andrewhowdencom/pi.litellm";

export interface LiteLLMSettings {
	baseUrl?: string;
	apiKey?: string;
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
		throw new Error(`Invalid base URL: "${url}" is not a valid URL`);
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

export function loadSettings(deps?: {
	readFile?: (path: string, encoding: string) => string;
	cwd?: () => string;
	homedir?: () => string;
}): LiteLLMSettings | undefined {
	const readFile = deps?.readFile ?? readFileSync;
	const cwd = deps?.cwd ?? process.cwd;
	const home = deps?.homedir ?? homedir;

	const paths = [
		join(cwd(), ".pi", "settings.json"),
		join(home(), ".pi", "agent", "settings.json"),
	];

	for (const path of paths) {
		try {
			const raw = readFile(path, "utf-8");
			const settings = JSON.parse(raw) as Record<string, unknown>;
			const extSettings = settings[REPO_KEY] as
				| { baseUrl?: string; apiKey?: string }
				| undefined;
			if (extSettings) {
				return {
					baseUrl: extSettings.baseUrl,
					apiKey: extSettings.apiKey,
				};
			}
		} catch (err) {
			if (err instanceof Error && (err as { code?: unknown }).code === "ENOENT") {
				continue;
			}
			// Silently ignore malformed JSON — graceful degradation per Pi extension skill
		}
	}
	return undefined;
}

export function resolveConfig(deps?: {
	readFile?: (path: string, encoding: string) => string;
	cwd?: () => string;
	homedir?: () => string;
}): LiteLLMConfig {
	const settings = loadSettings(deps);

	const baseUrlRaw = settings?.baseUrl;
	if (!baseUrlRaw) {
		throw new Error(
			"LiteLLM baseUrl is required. " +
				"Set it in ~/.pi/agent/settings.json or ./.pi/settings.json, " +
				"e.g. http://localhost:4000",
		);
	}

	const baseUrl = normalizeBaseUrl(baseUrlRaw);
	validateUrl(baseUrl);

	const apiKey = settings?.apiKey;
	const modelOverrides = loadConfigFile(deps);

	return {
		baseUrl,
		apiKey,
		modelOverrides,
	};
}

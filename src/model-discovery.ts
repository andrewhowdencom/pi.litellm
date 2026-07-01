export interface LiteLLMModelInfo {
	id: string;
	name?: string;
	provider?: string;
	max_tokens?: number;
	max_input_tokens?: number;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
}

function buildHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`;
	}
	return headers;
}

export function isValidModelInfoResponse(data: unknown): data is {
	data: Array<{
		model_name?: string;
		litellm_params?: { model?: string; custom_llm_provider?: string };
		model_info?: {
			id?: string;
			max_tokens?: number;
			max_input_tokens?: number;
			input_cost_per_token?: number;
			output_cost_per_token?: number;
		};
	}>;
} {
	return (
		typeof data === "object" &&
		data !== null &&
		"data" in data &&
		Array.isArray((data as Record<string, unknown>).data)
	);
}

export function isValidModelsResponse(data: unknown): data is {
	data: Array<{ id?: string; owned_by?: string }>;
} {
	return (
		typeof data === "object" &&
		data !== null &&
		"data" in data &&
		Array.isArray((data as Record<string, unknown>).data)
	);
}

async function fetchModelInfo(
	baseUrl: string,
	apiKey?: string,
	signal?: AbortSignal,
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LiteLLMModelInfo[] | null> {
	const url = `${baseUrl}/model/info`;
	try {
		const response = await fetchImpl(url, {
			headers: buildHeaders(apiKey),
			signal,
		});

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			console.warn(
				`LiteLLM /model/info returned ${response.status} — skipping metadata enrichment`,
			);
			return null;
		}

		const data = (await response.json()) as unknown;

		if (!isValidModelInfoResponse(data)) {
			console.warn(
				"LiteLLM /model/info returned unexpected shape — skipping metadata enrichment",
			);
			return null;
		}

		return data.data
			.map((entry) => {
				const info = entry.model_info ?? {};
				return {
					id: entry.model_name ?? entry.litellm_params?.model ?? info.id ?? "unknown",
					name: entry.model_name ?? entry.litellm_params?.model ?? info.id,
					provider: entry.litellm_params?.custom_llm_provider,
					max_tokens: info.max_tokens,
					max_input_tokens: info.max_input_tokens,
					input_cost_per_token: info.input_cost_per_token,
					output_cost_per_token: info.output_cost_per_token,
				};
			})
			.filter((m) => m.id !== "unknown");
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw err;
		}
		console.warn(
			`LiteLLM /model/info request failed (${err instanceof Error ? err.message : String(err)}) — skipping metadata enrichment`,
		);
		return null;
	}
}

async function fetchModelsList(
	baseUrl: string,
	apiKey?: string,
	signal?: AbortSignal,
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LiteLLMModelInfo[]> {
	const url = `${baseUrl}/models`;
	try {
		const response = await fetchImpl(url, {
			headers: buildHeaders(apiKey),
			signal,
		});

		if (!response.ok) {
			throw new Error(
				`LiteLLM /v1/models returned ${response.status}: ${await response.text()}`,
			);
		}

		const data = (await response.json()) as unknown;

		if (!isValidModelsResponse(data)) {
			throw new Error(
				"LiteLLM /v1/models returned unexpected response shape (expected { data: [...] })",
			);
		}

		return data.data
			.map((entry) => ({
				id: entry.id ?? "unknown",
				name: entry.id,
				provider: entry.owned_by,
			}))
			.filter((m) => m.id !== "unknown");
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw err;
		}
		throw new Error(
			`Failed to fetch models from LiteLLM: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Deduplicate models by `id`, keeping the first occurrence.
 *
 * LiteLLM's /model/info endpoint returns one entry per *deployment*, not per
 * public alias. A router config that fronts multiple backends behind a single
 * `model_name` (e.g. several Vertex AI projects load-balanced under
 * `claude-opus-4-7`) will therefore emit N entries that all collapse to the
 * same `id` after mapping. Pi's ModelRegistry stores models in a flat array
 * and resolves lookups via `Array.find()` (first match wins), so registering
 * duplicates produces N visually identical picker rows where only the first
 * is ever reachable via lookup. We dedupe here so pi only ever sees one entry
 * per public alias — which is also what /v1/models would have returned.
 */
export function dedupeById(models: LiteLLMModelInfo[]): LiteLLMModelInfo[] {
	const seen = new Set<string>();
	const result: LiteLLMModelInfo[] = [];
	for (const model of models) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		result.push(model);
	}
	return result;
}

/**
 * Merge metadata from /model/info onto the authoritative /v1/models list.
 *
 * The authoritative list defines *which* models are shown (it is key-scoped),
 * while /model/info supplies cost and context-window metadata. We join on
 * `id` (which corresponds to the LiteLLM `model_name`) and copy metadata
 * fields when a match exists. Models absent from the info map keep their
 * base shape (metadata falls back to mapping defaults and user overrides).
 */
export function enrichModels(
	base: LiteLLMModelInfo[],
	infoById: Map<string, LiteLLMModelInfo>,
): LiteLLMModelInfo[] {
	return base.map((model) => {
		const info = infoById.get(model.id);
		if (!info) return model;
		return {
			...model,
			provider: info.provider ?? model.provider,
			max_tokens: info.max_tokens ?? model.max_tokens,
			max_input_tokens: info.max_input_tokens ?? model.max_input_tokens,
			input_cost_per_token: info.input_cost_per_token ?? model.input_cost_per_token,
			output_cost_per_token: info.output_cost_per_token ?? model.output_cost_per_token,
		};
	});
}

/**
 * Discover the models the caller's API key can use.
 *
 * `/v1/models` is the authoritative, key-scoped source of *which* models to
 * show — it returns exactly the aliases the key may call, with no duplicate
 * per-deployment rows and no tag-gated entries the key cannot reach.
 * `/model/info` is used only to enrich those models with cost and
 * context-window metadata; if it is unavailable or malformed we degrade
 * gracefully and return the key-scoped list without enrichment.
 */
export async function discoverModels(
	baseUrl: string,
	apiKey?: string,
	signal?: AbortSignal,
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LiteLLMModelInfo[]> {
	const authoritative = dedupeById(
		await fetchModelsList(baseUrl, apiKey, signal, fetchImpl),
	);

	const fromModelInfo = await fetchModelInfo(baseUrl, apiKey, signal, fetchImpl);
	const finalModels = !fromModelInfo || fromModelInfo.length === 0
		? authoritative
		: enrichModels(authoritative, infoById(fromModelInfo));

	return finalModels.sort((a, b) => {
		const provA = a.provider?.toLowerCase();
		const provB = b.provider?.toLowerCase();

		if (provA !== provB) {
			if (!provA) return 1;
			if (!provB) return -1;
			return provA.localeCompare(provB);
		}

		return a.id.localeCompare(b.id);
	});
}

function infoById(fromModelInfo: LiteLLMModelInfo[]): Map<string, LiteLLMModelInfo> {
	const map = new Map<string, LiteLLMModelInfo>();
	for (const info of dedupeById(fromModelInfo)) {
		map.set(info.id, info);
	}
	return map;
}

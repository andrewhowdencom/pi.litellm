export interface LiteLLMModelInfo {
	id: string;
	name?: string;
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
		litellm_params?: { model?: string };
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
	data: Array<{ id?: string }>;
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
				`LiteLLM /model/info returned ${response.status} — falling back to /v1/models`,
			);
			return null;
		}

		const data = (await response.json()) as unknown;

		if (!isValidModelInfoResponse(data)) {
			console.warn(
				"LiteLLM /model/info returned unexpected shape — falling back to /v1/models",
			);
			return null;
		}

		return data.data
			.map((entry) => {
				const info = entry.model_info ?? {};
				return {
					id: info.id ?? entry.model_name ?? entry.litellm_params?.model ?? "unknown",
					name: entry.model_name ?? entry.litellm_params?.model,
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
			`LiteLLM /model/info request failed (${err instanceof Error ? err.message : String(err)}) — falling back to /v1/models`,
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

export async function discoverModels(
	baseUrl: string,
	apiKey?: string,
	signal?: AbortSignal,
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<LiteLLMModelInfo[]> {
	const fromModelInfo = await fetchModelInfo(baseUrl, apiKey, signal, fetchImpl);
	if (fromModelInfo && fromModelInfo.length > 0) {
		return fromModelInfo;
	}

	return fetchModelsList(baseUrl, apiKey, signal, fetchImpl);
}

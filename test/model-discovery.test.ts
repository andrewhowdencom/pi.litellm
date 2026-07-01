import { describe, it, expect, vi } from "vitest";
import { discoverModels, dedupeById, enrichModels } from "../src/model-discovery.js";

function mockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("discoverModels", () => {
	it("uses /v1/models as the authoritative list and enriches from /model/info", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [
						{
							model_name: "gpt-4",
							model_info: {
								id: "uuid-1",
								max_tokens: 4096,
								max_input_tokens: 128000,
								input_cost_per_token: 0.00001,
								output_cost_per_token: 0.00003,
							},
						},
					],
				});
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("gpt-4");
		expect(models[0].max_tokens).toBe(4096);
		expect(models[0].max_input_tokens).toBe(128000);
		expect(models[0].input_cost_per_token).toBe(0.00001);
		expect(models[0].output_cost_per_token).toBe(0.00003);
		// both endpoints are consulted: /v1/models first, then /model/info
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch.mock.calls[0][0]).toContain("/models");
		expect(mockFetch.mock.calls[1][0]).toContain("/model/info");
	});

	it("shows a model present in /v1/models but absent from /model/info (no metadata)", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [{ model_name: "gpt-4", model_info: { id: "u", max_tokens: 4096 } }],
				});
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }, { id: "claude-sonnet" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["claude-sonnet", "gpt-4"]);
		const claude = models.find((m) => m.id === "claude-sonnet")!;
		expect(claude.max_tokens).toBeUndefined();
	});

	it("excludes a model present only in /model/info (not key-scoped)", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [
						{ model_name: "gpt-4", model_info: { id: "u1" } },
						{ model_name: "secret-model", model_info: { id: "u2" } },
					],
				});
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["gpt-4"]);
	});

	it("returns key-scoped list without enrichment when /model/info returns 404", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Not found" }, 404);
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }, { id: "claude" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["claude", "gpt-4"]);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns key-scoped list without enrichment when /model/info returns 500", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Internal error" }, 500);
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["gpt-4"]);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns key-scoped list without enrichment when /model/info shape is invalid", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ models: [] });
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["gpt-4"]);
	});

	it("returns key-scoped list without enrichment when /model/info network fails", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				throw new Error("Network error");
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["gpt-4"]);
	});

	it("returns key-scoped list without enrichment when /model/info is empty", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ data: [] });
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["gpt-4"]);
	});

	it("re-throws AbortError from /v1/models without enriching", async () => {
		const abortError = new Error("Aborted");
		abortError.name = "AbortError";

		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/models") && !input.includes("/model/info")) {
				throw abortError;
			}
			return mockResponse({ data: [] });
		});

		await expect(
			discoverModels("http://localhost:4000", undefined, undefined, mockFetch),
		).rejects.toThrow("Aborted");
	});

	it("re-throws AbortError from /model/info", async () => {
		const abortError = new Error("Aborted");
		abortError.name = "AbortError";

		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				throw abortError;
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "gpt-4" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		await expect(
			discoverModels("http://localhost:4000", undefined, undefined, mockFetch),
		).rejects.toThrow("Aborted");
	});

	it("surfaces an error when /v1/models fails", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/models") && !input.includes("/model/info")) {
				return mockResponse({ error: "Bad gateway" }, 502);
			}
			return mockResponse({ data: [] });
		});

		await expect(
			discoverModels("http://localhost:4000", undefined, undefined, mockFetch),
		).rejects.toThrow("502");
	});

	it("deduplicates authoritative /v1/models entries", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Not found" }, 404);
			}
			if (input.includes("/models")) {
				return mockResponse({
					data: [{ id: "gpt-4" }, { id: "gpt-4" }, { id: "claude" }],
				});
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual(["claude", "gpt-4"]);
	});

	it("deduplicates /model/info entries that share a model_name before enriching", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [
						{ model_name: "claude-opus-4-7", model_info: { id: "uuid-1", max_tokens: 128000 } },
						{ model_name: "claude-opus-4-7", model_info: { id: "uuid-2", max_tokens: 999 } },
						{ model_name: "claude-opus-4-7", model_info: { id: "uuid-3", max_tokens: 111 } },
					],
				});
			}
			if (input.includes("/models")) {
				return mockResponse({ data: [{ id: "claude-opus-4-7" }] });
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("claude-opus-4-7");
		// first occurrence wins for enrichment metadata
		expect(models[0].max_tokens).toBe(128000);
	});

	it("passes apiKey in Authorization header", async () => {
		const mockFetch = vi.fn(async () => {
			return mockResponse({ data: [{ id: "gpt-4" }] });
		});

		await discoverModels("http://localhost:4000", "sk-test-123", undefined, mockFetch);

		const [, requestInit] = mockFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
		expect(requestInit.headers["Authorization"]).toBe("Bearer sk-test-123");
	});

	it("passes signal to fetch", async () => {
		const mockFetch = vi.fn(async () => {
			return mockResponse({ data: [{ id: "gpt-4" }] });
		});

		const controller = new AbortController();
		await discoverModels("http://localhost:4000", undefined, controller.signal, mockFetch);

		const [, requestInit] = mockFetch.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
		expect(requestInit.signal).toBe(controller.signal);
	});

	it("sorts models by provider (with undefined provider last) and then alphabetically", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [
						{
							model_name: "gpt-4o",
							litellm_params: { custom_llm_provider: "openai" },
						},
						{
							model_name: "claude-3-5-sonnet",
							litellm_params: { custom_llm_provider: "anthropic" },
						},
						{
							model_name: "gemini-1.5-pro",
							litellm_params: { custom_llm_provider: "google" },
						},
						{
							model_name: "unknown-provider-model",
							// no custom_llm_provider
						},
					],
				});
			}
			if (input.includes("/models")) {
				return mockResponse({
					data: [
						{ id: "gpt-4o" },
						{ id: "unknown-provider-model" },
						{ id: "claude-3-5-sonnet" },
						{ id: "gemini-1.5-pro" },
					],
				});
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		// Expected order:
		// 1. anthropic (claude-3-5-sonnet)
		// 2. google (gemini-1.5-pro)
		// 3. openai (gpt-4o)
		// 4. undefined/last (unknown-provider-model)
		expect(models.map((m) => m.id)).toEqual([
			"claude-3-5-sonnet",
			"gemini-1.5-pro",
			"gpt-4o",
			"unknown-provider-model",
		]);
	});

	it("extracts and sorts by provider parsed from /v1/models owned_by field when /model/info is unavailable", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Not found" }, 404);
			}
			if (input.includes("/models")) {
				return mockResponse({
					data: [
						{ id: "gpt-4o", owned_by: "openai" },
						{ id: "claude-3-5-sonnet", owned_by: "anthropic" },
						{ id: "gemini-1.5-pro", owned_by: "google" },
					],
				});
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		const models = await discoverModels(
			"http://localhost:4000",
			undefined,
			undefined,
			mockFetch,
		);

		expect(models.map((m) => m.id)).toEqual([
			"claude-3-5-sonnet",
			"gemini-1.5-pro",
			"gpt-4o",
		]);
	});
});

describe("enrichModels", () => {
	it("copies metadata onto matching base models by id", () => {
		const base = [{ id: "a", name: "a" }, { id: "b", name: "b" }];
		const infoById = new Map([
			["a", { id: "a", max_tokens: 100, input_cost_per_token: 0.001 }],
		]);
		const result = enrichModels(base, infoById);
		expect(result[0]).toMatchObject({ id: "a", max_tokens: 100, input_cost_per_token: 0.001 });
		expect(result[1]).toEqual({ id: "b", name: "b" });
	});

	it("returns base unchanged when the info map is empty", () => {
		const base = [{ id: "a" }, { id: "b" }];
		expect(enrichModels(base, new Map())).toEqual(base);
	});
});

describe("dedupeById", () => {
	it("keeps the first occurrence of each id", () => {
		const result = dedupeById([
			{ id: "a", name: "first-a" },
			{ id: "b", name: "only-b" },
			{ id: "a", name: "second-a" },
			{ id: "a", name: "third-a" },
		]);
		expect(result).toEqual([
			{ id: "a", name: "first-a" },
			{ id: "b", name: "only-b" },
		]);
	});

	it("returns an empty array unchanged", () => {
		expect(dedupeById([])).toEqual([]);
	});

	it("is a no-op when all ids are unique", () => {
		const input = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(dedupeById(input)).toEqual(input);
	});
});

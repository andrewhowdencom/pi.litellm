import { describe, it, expect, vi } from "vitest";
import { discoverModels } from "../src/model-discovery.js";

function mockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("discoverModels", () => {
	it("uses /model/info when available with valid data", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({
					data: [
						{
							model_name: "gpt-4",
							model_info: { id: "gpt-4", max_tokens: 4096 },
						},
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

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("gpt-4");
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch.mock.calls[0][0]).toContain("/model/info");
	});

	it("falls back to /v1/models when /model/info returns 404", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Not found" }, 404);
			}
			if (input.includes("/models")) {
				return mockResponse({
					data: [{ id: "gpt-4" }, { id: "claude-sonnet" }],
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

		expect(models).toHaveLength(2);
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch.mock.calls[0][0]).toContain("/model/info");
		expect(mockFetch.mock.calls[1][0]).toContain("/models");
	});

	it("falls back to /v1/models when /model/info returns 500", async () => {
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

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("gpt-4");
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("falls back to /v1/models when /model/info returns invalid shape", async () => {
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

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("gpt-4");
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("falls back to /v1/models when /model/info network fails", async () => {
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

		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("gpt-4");
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("re-throws AbortError without falling back", async () => {
		const abortError = new Error("Aborted");
		abortError.name = "AbortError";

		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				throw abortError;
			}
			return mockResponse({ data: [{ id: "gpt-4" }] });
		});

		await expect(
			discoverModels("http://localhost:4000", undefined, undefined, mockFetch),
		).rejects.toThrow("Aborted");

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("throws when both endpoints fail", async () => {
		const mockFetch = vi.fn(async (input: any) => {
			if (input.includes("/model/info")) {
				return mockResponse({ error: "Internal error" }, 500);
			}
			if (input.includes("/models")) {
				return mockResponse({ error: "Bad gateway" }, 502);
			}
			return mockResponse({ error: "Not found" }, 404);
		});

		await expect(
			discoverModels("http://localhost:4000", undefined, undefined, mockFetch),
		).rejects.toThrow("502");

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("falls back when /model/info returns empty array", async () => {
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

		expect(models).toHaveLength(1);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("passes apiKey in Authorization header", async () => {
		const mockFetch = vi.fn(async () => {
			return mockResponse({ data: [{ model_name: "gpt-4", model_info: { id: "gpt-4" } }] });
		});

		await discoverModels("http://localhost:4000", "sk-test-123", undefined, mockFetch);

		const [, requestInit] = mockFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
		expect(requestInit.headers["Authorization"]).toBe("Bearer sk-test-123");
	});

	it("passes signal to fetch", async () => {
		const mockFetch = vi.fn(async () => {
			return mockResponse({ data: [{ model_name: "gpt-4", model_info: { id: "gpt-4" } }] });
		});

		const controller = new AbortController();
		await discoverModels("http://localhost:4000", undefined, controller.signal, mockFetch);

		const [, requestInit] = mockFetch.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
		expect(requestInit.signal).toBe(controller.signal);
	});
});

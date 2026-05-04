import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
	it("throws when LITELLM_BASE_URL is missing", () => {
		expect(() => resolveConfig({ env: {} })).toThrow(
			"LITELLM_BASE_URL environment variable is required",
		);
	});

	it("normalizes URL without trailing slash", () => {
		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000" },
		});
		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("normalizes URL with trailing slash", () => {
		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000/" },
		});
		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("does not double-add /v1 when URL already ends with /v1", () => {
		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000/v1" },
		});
		expect(config.baseUrl).toBe("http://localhost:4000/v1");
	});

	it("throws when URL is invalid", () => {
		expect(() =>
			resolveConfig({ env: { LITELLM_BASE_URL: "not-a-url" } }),
		).toThrow("Invalid LITELLM_BASE_URL");
	});

	it("returns undefined modelOverrides when config file is missing", () => {
		const enoentError = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		const mockReadFile = () => {
			throw enoentError;
		};

		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000" },
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
		});

		expect(config.modelOverrides).toBeUndefined();
	});

	it("returns modelOverrides from valid config file", () => {
		const mockReadFile = () =>
			JSON.stringify({
				modelOverrides: {
					"gpt-4": { contextWindow: 32768, cost: { input: 30, output: 60 } },
				},
			});

		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000" },
			readFile: mockReadFile,
			cwd: () => "/fake/cwd",
		});

		expect(config.modelOverrides).toEqual({
			"gpt-4": { contextWindow: 32768, cost: { input: 30, output: 60 } },
		});
	});

	it("throws with helpful message when config file JSON is invalid", () => {
		const mockReadFile = () => "{ invalid json";

		expect(() =>
			resolveConfig({
				env: { LITELLM_BASE_URL: "http://localhost:4000" },
				readFile: mockReadFile,
				cwd: () => "/fake/cwd",
			}),
		).toThrow("Failed to parse .pi/litellm.json");
	});

	it("includes apiKey when LITELLM_API_KEY is set", () => {
		const config = resolveConfig({
			env: {
				LITELLM_BASE_URL: "http://localhost:4000",
				LITELLM_API_KEY: "sk-test-123",
			},
		});

		expect(config.apiKey).toBe("sk-test-123");
	});

	it("returns undefined apiKey when LITELLM_API_KEY is absent", () => {
		const config = resolveConfig({
			env: { LITELLM_BASE_URL: "http://localhost:4000" },
		});

		expect(config.apiKey).toBeUndefined();
	});
});

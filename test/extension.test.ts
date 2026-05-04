import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
	resolveConfig: vi.fn(),
}));

vi.mock("../src/model-discovery.js", () => ({
	discoverModels: vi.fn(),
}));

import { resolveConfig } from "../src/config.js";
import { discoverModels } from "../src/model-discovery.js";
import defaultFactory from "../extensions/index.js";

interface MockExtensionAPI {
	registerProvider: ReturnType<typeof vi.fn>;
}

describe("extension entry point", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers provider on success", async () => {
		const mockRegisterProvider = vi.fn();
		const mockPi = { registerProvider: mockRegisterProvider } as MockExtensionAPI;

		vi.mocked(resolveConfig).mockReturnValue({
			baseUrl: "http://localhost:4000/v1",
			apiKey: "sk-test",
			modelOverrides: {},
		});

		vi.mocked(discoverModels).mockResolvedValue([
			{ id: "gpt-4", name: "GPT-4", max_tokens: 4096, max_input_tokens: 8192 },
		]);

		await defaultFactory(mockPi as never);

		expect(mockRegisterProvider).toHaveBeenCalledTimes(1);
		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"litellm",
			expect.objectContaining({
				name: "LiteLLM",
				baseUrl: "http://localhost:4000/v1",
				apiKey: "sk-test",
				api: "openai-completions",
				authHeader: true,
				models: expect.any(Array),
			}),
		);
	});

	it("does not register provider when config fails", async () => {
		const mockRegisterProvider = vi.fn();
		const mockPi = { registerProvider: mockRegisterProvider } as MockExtensionAPI;
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		vi.mocked(resolveConfig).mockImplementation(() => {
			throw new Error("Config error");
		});

		await defaultFactory(mockPi as never);

		expect(mockRegisterProvider).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("Configuration error:"),
			"Config error",
		);

		consoleSpy.mockRestore();
	});

	it("does not register provider when discovery fails", async () => {
		const mockRegisterProvider = vi.fn();
		const mockPi = { registerProvider: mockRegisterProvider } as MockExtensionAPI;
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		vi.mocked(resolveConfig).mockReturnValue({
			baseUrl: "http://localhost:4000/v1",
		});

		vi.mocked(discoverModels).mockRejectedValue(new Error("Discovery error"));

		await defaultFactory(mockPi as never);

		expect(mockRegisterProvider).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("Model discovery failed:"),
			"Discovery error",
		);

		consoleSpy.mockRestore();
	});

	it("registers provider with empty models array", async () => {
		const mockRegisterProvider = vi.fn();
		const mockPi = { registerProvider: mockRegisterProvider } as MockExtensionAPI;
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.mocked(resolveConfig).mockReturnValue({
			baseUrl: "http://localhost:4000/v1",
		});

		vi.mocked(discoverModels).mockResolvedValue([]);

		await defaultFactory(mockPi as never);

		expect(mockRegisterProvider).toHaveBeenCalledTimes(1);
		expect(mockRegisterProvider).toHaveBeenCalledWith(
			"litellm",
			expect.objectContaining({
				models: [],
			}),
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("No models discovered"),
		);

		consoleSpy.mockRestore();
	});
});

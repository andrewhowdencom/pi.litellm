import { describe, it, expect } from "vitest";
import {
	mapToPiModel,
	hasVisionSupport,
	hasReasoningSupport,
	costPerMillion,
	clampPositiveInt,
} from "../src/model-mapping.js";
import type { LiteLLMModelInfo } from "../src/model-discovery.js";
import type { ModelOverrides } from "../src/config.js";

describe("hasVisionSupport", () => {
	it.each([
		{ modelId: "gpt-4o", expected: true },
		{ modelId: "gpt-4o-mini", expected: true },
		{ modelId: "claude-sonnet-4", expected: true },
		{ modelId: "claude-3-5-sonnet-20241022", expected: true },
		{ modelId: "gemini-1.5-flash", expected: true },
		{ modelId: "llava-v1.5", expected: true },
		{ modelId: "gpt-4-vision-preview", expected: true },
		{ modelId: "gpt-4", expected: false },
		{ modelId: "gpt-4-turbo", expected: false },
		{ modelId: "claude-haiku", expected: false },
		{ modelId: "o1-preview", expected: false },
		{ modelId: "deepseek-r1", expected: false },
		{ modelId: "my-o1-model", expected: false },
		{ modelId: "gemini-pro-text", expected: true },
		{ modelId: "text-embedding-ada-002", expected: false },
		{ modelId: "llama-3-70b", expected: false },
	])("hasVisionSupport($modelId) -> $expected", ({ modelId, expected }) => {
		expect(hasVisionSupport(modelId)).toBe(expected);
	});
});

describe("hasReasoningSupport", () => {
	it.each([
		{ modelId: "o1", expected: true },
		{ modelId: "o1-preview", expected: true },
		{ modelId: "o3", expected: true },
		{ modelId: "o3-mini", expected: true },
		{ modelId: "deepseek-r1", expected: true },
		{ modelId: "reasoning-model", expected: true },
		{ modelId: "thinking-claude", expected: true },
		{ modelId: "r1", expected: true },
		{ modelId: "my-r1-model", expected: true },
		{ modelId: "r1-turbo", expected: true },
		{ modelId: "o1-model", expected: true },
		{ modelId: "my-o1-model", expected: true },
		{ modelId: "gpt-4o", expected: false },
		{ modelId: "gpt-4", expected: false },
		{ modelId: "claude-sonnet", expected: false },
		{ modelId: "gemini-1.5", expected: false },
		{ modelId: "llava", expected: false },
		{ modelId: "o12", expected: false },
		{ modelId: "ao1", expected: false },
		{ modelId: "deepseek-reasoner", expected: false },
		{ modelId: "o1reasoning", expected: true },
		{ modelId: "o1model", expected: false },
	])("hasReasoningSupport($modelId) -> $expected", ({ modelId, expected }) => {
		expect(hasReasoningSupport(modelId)).toBe(expected);
	});
});

describe("costPerMillion", () => {
	it.each([
		{ input: undefined, expected: 0 },
		{ input: null as unknown as number, expected: 0 },
		{ input: NaN, expected: 0 },
		{ input: 0, expected: 0 },
		{ input: 0.00003, expected: 30 },
		{ input: 0.00006, expected: 60 },
		{ input: -0.00001, expected: -10 },
		{ input: 0.00000055, expected: 0.55 },
		{ input: 1000000, expected: 1000000000000 },
	])("costPerMillion($input) -> $expected", ({ input, expected }) => {
		expect(costPerMillion(input)).toBe(expected);
	});
});

describe("clampPositiveInt", () => {
	it.each([
		{ value: undefined, defaultValue: 100, expected: 100 },
		{ value: null as unknown as number, defaultValue: 100, expected: 100 },
		{ value: NaN, defaultValue: 100, expected: 100 },
		{ value: -1, defaultValue: 100, expected: 100 },
		{ value: 0, defaultValue: 100, expected: 100 },
		{ value: 1, defaultValue: 100, expected: 1 },
		{ value: 100, defaultValue: 50, expected: 100 },
		{ value: 100.7, defaultValue: 50, expected: 100 },
		{ value: 999999, defaultValue: 50, expected: 999999 },
	])("clampPositiveInt($value, $defaultValue) -> $expected", ({ value, defaultValue, expected }) => {
		expect(clampPositiveInt(value, defaultValue)).toBe(expected);
	});
});

describe("mapToPiModel", () => {
	it("maps a model with full metadata and no overrides", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			name: "GPT-4",
			max_tokens: 4096,
			max_input_tokens: 8192,
			input_cost_per_token: 0.00003,
			output_cost_per_token: 0.00006,
		};

		const result = mapToPiModel(model);

		expect(result).toEqual({
			id: "gpt-4",
			name: "GPT-4",
			reasoning: false,
			input: ["text"],
			cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 4096,
		});
	});

	it("maps a vision model (gpt-4o) with correct heuristics", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4o",
			max_tokens: 4096,
			max_input_tokens: 128000,
			input_cost_per_token: 0.000005,
			output_cost_per_token: 0.000015,
		};

		const result = mapToPiModel(model);

		expect(result.input).toEqual(["text", "image"]);
		expect(result.reasoning).toBe(false);
		expect(result.contextWindow).toBe(128000);
		expect(result.maxTokens).toBe(4096);
		expect(result.cost).toEqual({ input: 5, output: 15, cacheRead: 0, cacheWrite: 0 });
	});

	it("maps a reasoning model (deepseek-r1) with correct heuristics", () => {
		const model: LiteLLMModelInfo = {
			id: "deepseek-r1",
			max_tokens: 8192,
			max_input_tokens: 64000,
			input_cost_per_token: 0.00000055,
			output_cost_per_token: 0.00000219,
		};

		const result = mapToPiModel(model);

		expect(result.reasoning).toBe(true);
		expect(result.input).toEqual(["text"]);
		expect(result.contextWindow).toBe(64000);
		expect(result.maxTokens).toBe(8192);
		expect(result.cost.input).toBe(0.55);
		expect(result.cost.output).toBeCloseTo(2.19, 10);
		expect(result.cost.cacheRead).toBe(0);
		expect(result.cost.cacheWrite).toBe(0);
	});

	it("maps a model with only id (minimal metadata)", () => {
		const model: LiteLLMModelInfo = {
			id: "unknown-model",
		};

		const result = mapToPiModel(model);

		expect(result).toEqual({
			id: "unknown-model",
			name: "unknown-model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		});
	});

	it("applies full overrides", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			name: "GPT-4",
			max_tokens: 4096,
			max_input_tokens: 8192,
			input_cost_per_token: 0.00003,
			output_cost_per_token: 0.00006,
		};

		const overrides: ModelOverrides = {
			name: "Custom Name",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 99,
				output: 88,
				cacheRead: 77,
				cacheWrite: 66,
			},
			contextWindow: 9999,
			maxTokens: 1111,
		};

		const result = mapToPiModel(model, overrides);

		expect(result).toEqual({
			id: "gpt-4",
			name: "Custom Name",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 99, output: 88, cacheRead: 77, cacheWrite: 66 },
			contextWindow: 9999,
			maxTokens: 1111,
		});
	});

	it("applies partial overrides (only contextWindow)", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			max_tokens: 4096,
			max_input_tokens: 8192,
			input_cost_per_token: 0.00003,
			output_cost_per_token: 0.00006,
		};

		const overrides: ModelOverrides = {
			contextWindow: 32768,
		};

		const result = mapToPiModel(model, overrides);

		expect(result.contextWindow).toBe(32768);
		expect(result.maxTokens).toBe(4096);
		expect(result.name).toBe("gpt-4");
		expect(result.reasoning).toBe(false);
		expect(result.input).toEqual(["text"]);
		expect(result.cost).toEqual({ input: 30, output: 60, cacheRead: 0, cacheWrite: 0 });
	});

	it("applies partial overrides (only reasoning)", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			max_tokens: 4096,
			max_input_tokens: 8192,
		};

		const overrides: ModelOverrides = {
			reasoning: true,
		};

		const result = mapToPiModel(model, overrides);

		expect(result.reasoning).toBe(true);
		expect(result.input).toEqual(["text"]);
	});

	it("applies partial overrides (only input modalities)", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			max_tokens: 4096,
			max_input_tokens: 8192,
		};

		const overrides: ModelOverrides = {
			input: ["text", "image"],
		};

		const result = mapToPiModel(model, overrides);

		expect(result.input).toEqual(["text", "image"]);
		expect(result.reasoning).toBe(false);
	});

	it("name falls back to id when model.name is undefined", () => {
		const model: LiteLLMModelInfo = {
			id: "custom-id",
		};

		const result = mapToPiModel(model);

		expect(result.name).toBe("custom-id");
	});

	it("contextWindow falls back to max_tokens when max_input_tokens is undefined", () => {
		const model: LiteLLMModelInfo = {
			id: "test",
			max_tokens: 16000,
		};

		const result = mapToPiModel(model);

		expect(result.contextWindow).toBe(16000);
	});

	it("contextWindow falls back to default when both max_input_tokens and max_tokens are undefined", () => {
		const model: LiteLLMModelInfo = {
			id: "test",
		};

		const result = mapToPiModel(model);

		expect(result.contextWindow).toBe(128000);
	});

	it("maxTokens falls back to default when max_tokens is undefined", () => {
		const model: LiteLLMModelInfo = {
			id: "test",
			max_input_tokens: 64000,
		};

		const result = mapToPiModel(model);

		expect(result.maxTokens).toBe(4096);
	});

	it("override name takes precedence over model.name", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			name: "Original Name",
		};

		const overrides: ModelOverrides = {
			name: "Override Name",
		};

		const result = mapToPiModel(model, overrides);

		expect(result.name).toBe("Override Name");
	});

	it("override reasoning takes precedence over heuristic", () => {
		const model: LiteLLMModelInfo = {
			id: "deepseek-r1",
		};

		const overrides: ModelOverrides = {
			reasoning: false,
		};

		const result = mapToPiModel(model, overrides);

		expect(result.reasoning).toBe(false);
	});

	it("override input takes precedence over heuristic", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4o",
		};

		const overrides: ModelOverrides = {
			input: ["text"],
		};

		const result = mapToPiModel(model, overrides);

		expect(result.input).toEqual(["text"]);
	});

	it("override cost takes precedence over discovered cost", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			input_cost_per_token: 0.00003,
			output_cost_per_token: 0.00006,
		};

		const overrides: ModelOverrides = {
			cost: {
				input: 50,
			},
		};

		const result = mapToPiModel(model, overrides);

		expect(result.cost.input).toBe(50);
		expect(result.cost.output).toBe(60);
		expect(result.cost.cacheRead).toBe(0);
		expect(result.cost.cacheWrite).toBe(0);
	});

	it("override maxTokens takes precedence over discovered max_tokens", () => {
		const model: LiteLLMModelInfo = {
			id: "gpt-4",
			max_tokens: 4096,
		};

		const overrides: ModelOverrides = {
			maxTokens: 8192,
		};

		const result = mapToPiModel(model, overrides);

		expect(result.maxTokens).toBe(8192);
	});
});

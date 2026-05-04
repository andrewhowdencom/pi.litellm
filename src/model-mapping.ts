import type { LiteLLMModelInfo } from "./model-discovery.js";
import type { ModelOverrides } from "./config.js";

export interface PiModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 4096;

function hasVisionSupport(modelId: string): boolean {
	const visionPatterns = /vision|gpt-4o|claude-.*sonnet|gemini|llava/i;
	return visionPatterns.test(modelId);
}

function hasReasoningSupport(modelId: string): boolean {
	const reasoningPatterns = /\bo1\b|\bo3\b|reasoning|thinking|\br1\b|deepseek-r1/i;
	return reasoningPatterns.test(modelId);
}

function costPerMillion(tokenCost?: number): number {
	if (tokenCost === undefined || tokenCost === null || Number.isNaN(tokenCost)) {
		return 0;
	}
	return tokenCost * 1_000_000;
}

function clampPositiveInt(value: number | undefined, defaultValue: number): number {
	if (value === undefined || value === null || Number.isNaN(value) || value <= 0) {
		return defaultValue;
	}
	return Math.floor(value);
}

export function mapToPiModel(
	model: LiteLLMModelInfo,
	overrides?: ModelOverrides,
): PiModelConfig {
	const id = model.id;
	const name = overrides?.name ?? model.name ?? id;

	const contextWindow = clampPositiveInt(
		overrides?.contextWindow ?? model.max_input_tokens ?? model.max_tokens,
		DEFAULT_CONTEXT_WINDOW,
	);

	const maxTokens = clampPositiveInt(
		overrides?.maxTokens ?? model.max_tokens,
		DEFAULT_MAX_TOKENS,
	);

	const input: ("text" | "image")[] = overrides?.input ?? (hasVisionSupport(id) ? ["text", "image"] : ["text"]);
	const reasoning = overrides?.reasoning ?? hasReasoningSupport(id);

	const costInput = overrides?.cost?.input ?? costPerMillion(model.input_cost_per_token);
	const costOutput = overrides?.cost?.output ?? costPerMillion(model.output_cost_per_token);
	const costCacheRead = overrides?.cost?.cacheRead ?? 0;
	const costCacheWrite = overrides?.cost?.cacheWrite ?? 0;

	return {
		id,
		name,
		reasoning,
		input,
		cost: {
			input: costInput,
			output: costOutput,
			cacheRead: costCacheRead,
			cacheWrite: costCacheWrite,
		},
		contextWindow,
		maxTokens,
	};
}

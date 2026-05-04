import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveConfig } from "../src/config.js";
import { discoverModels } from "../src/model-discovery.js";
import { mapToPiModel } from "../src/model-mapping.js";

export default async function (pi: ExtensionAPI): Promise<void> {
	let config;
	try {
		config = resolveConfig();
	} catch (err) {
		console.error(
			"[pi-litellm] Configuration error:",
			err instanceof Error ? err.message : String(err),
		);
		return;
	}

	let models;
	try {
		models = await discoverModels(config.baseUrl, config.apiKey);
	} catch (err) {
		console.error(
			"[pi-litellm] Model discovery failed:",
			err instanceof Error ? err.message : String(err),
		);
		return;
	}

	if (models.length === 0) {
		console.warn("[pi-litellm] No models discovered from LiteLLM proxy");
	}

	const mappedModels = models.map((model) =>
		mapToPiModel(model, config.modelOverrides?.[model.id]),
	);

	pi.registerProvider("litellm", {
		name: "LiteLLM",
		baseUrl: config.baseUrl,
		apiKey: config.apiKey,
		api: "openai-completions",
		authHeader: !!config.apiKey,
		models: mappedModels,
	});

	console.log(
		`[pi-litellm] Registered ${mappedModels.length} model(s) from LiteLLM at ${config.baseUrl}`,
	);
}

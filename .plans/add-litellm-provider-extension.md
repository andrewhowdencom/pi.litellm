# Plan: Add LiteLLM Provider Extension with Model Autodiscovery

## Objective

Create a Pi extension package (`pi.litellm`) that registers LiteLLM as a first-class provider with automatic model discovery. The extension fetches available models from a LiteLLM proxy at startup, maps them to Pi's model configuration format, and exposes them through Pi's standard `/model` selector and `--list-models` CLI flag. Users configure only the LiteLLM base URL (and optional API key); all model metadata is discovered dynamically.

## Context

**Repository state:** The project `pi.litellm` is currently empty (only `LICENSE`). This plan covers bootstrapping the entire extension from scratch.

**Pi extension architecture (from `docs/extensions.md`, `docs/custom-provider.md`):**
- Extensions are TypeScript modules loaded via jiti (no compilation step needed)
- Extensions export a default factory function receiving `ExtensionAPI`
- Async factories are awaited before startup, enabling dynamic initialization like remote model fetching
- `pi.registerProvider(name, config)` registers a provider with models, base URL, API type, and optional custom streaming
- `api: "openai-completions"` is the correct API type for LiteLLM, which is natively OpenAI-compatible
- The `models` array in `ProviderConfig` defines each model's `id`, `name`, `reasoning`, `input`, `cost`, `contextWindow`, and `maxTokens`
- Pi packages declare resources via a `pi` key in `package.json` with `extensions`, `skills`, `prompts`, `themes` arrays

**LiteLLM proxy capabilities:**
- Exposes OpenAI-compatible `/v1/models` endpoint returning `{ data: [{ id, object, created, owned_by }] }`
- Exposes LiteLLM-specific `/model/info` endpoint returning rich metadata including `max_tokens`, `max_input_tokens`, `input_cost_per_token`, `output_cost_per_token` per model
- All chat completions go through `/v1/chat/completions` with standard OpenAI schema
- Supports API key authentication via `Authorization: Bearer <key>` header

**Reference implementations examined:**
- `examples/extensions/custom-provider-anthropic/` — full custom streaming with OAuth
- `examples/extensions/custom-provider-gitlab-duo/` — provider delegating to built-in `streamSimpleAnthropic` and `streamSimpleOpenAIResponses`
- `examples/extensions/with-deps/` — npm dependency resolution in extension directories

## Architectural Blueprint

The extension follows the **async factory + dynamic model discovery** pattern documented in Pi's custom-provider docs. It is structured as a **Pi package** with a single extension entry point.

**Selected approach:** Async extension factory that queries LiteLLM endpoints at startup, transforms responses into Pi `ProviderModelConfig` objects, and registers the provider using Pi's built-in `openai-completions` streaming implementation. No custom `streamSimple` is needed because LiteLLM speaks native OpenAI.

**Tree-of-Thought deliberation:**

| Path | Description | Pros | Cons | Verdict |
|------|-------------|------|------|---------|
| A — Static `models.json` | User manually lists models in `~/.pi/agent/models.json` | Zero code; immediate | No autodiscovery; stale on model changes | Rejected — doesn't meet requirement |
| B — Simple `/v1/models` discovery | Fetch OpenAI-compatible model list only | Minimal code; universally supported | Minimal metadata (only IDs); missing costs, context windows | Partial — viable fallback |
| C — Rich `/model/info` discovery | Fetch LiteLLM-specific rich metadata first, fall back to `/v1/models` | Best metadata; graceful degradation; true autodiscovery | Slightly more complex; `/model/info` may not be exposed | **Selected** |
| D — Custom `streamSimple` | Implement own streaming logic | Maximum control | Entirely unnecessary; LiteLLM is OpenAI-compatible | Rejected — over-engineered |

**Components:**

1. **`extensions/index.ts`** — Async factory entry point. Reads env vars, fetches model lists, resolves metadata, calls `pi.registerProvider("litellm", { ... })`
2. **`src/model-discovery.ts`** — Module for querying LiteLLM endpoints (`/model/info`, `/v1/models`) and normalizing responses
3. **`src/model-mapping.ts`** — Module for mapping LiteLLM model metadata to Pi `ProviderModelConfig` with heuristic defaults
4. **`src/config.ts`** — Configuration resolver: env vars (`LITELLM_BASE_URL`, `LITELLM_API_KEY`), optional `.pi/litellm.json` overrides
5. **`package.json`** — Pi package manifest with `pi.extensions` entry, peer dependencies on Pi core packages
6. **`README.md`** — Installation, configuration, and usage documentation

**Data flow:**

```
Pi startup
    │
    ▼
Async extension factory loads
    │
    ├─► Read config (env vars + optional config file)
    │
    ├─► Fetch /model/info (LiteLLM-specific rich metadata)
    │   └─► On success: extract max_tokens, costs, context window
    │
    ├─► On /model/info failure: fetch /v1/models (OpenAI-compatible minimal list)
    │   └─► Only model IDs available
    │
    ├─► Map each model to ProviderModelConfig
    │   └─► Apply defaults for missing fields (contextWindow: 128000, maxTokens: 4096)
    │   └─► Apply user overrides from config file
    │
    └─► pi.registerProvider("litellm", { baseUrl, apiKey, api: "openai-completions", models })
```

## Requirements

1. **Autodiscovery:** At startup, the extension must fetch and register all models available from the configured LiteLLM proxy without requiring manual model enumeration. [inferred from user request]
2. **OpenAI compatibility:** Use Pi's built-in `openai-completions` API type; do not implement custom streaming. [inferred from LiteLLM's design]
3. **Rich metadata:** Prefer LiteLLM's `/model/info` endpoint for cost, context window, and token limit discovery; gracefully fall back to `/v1/models` with sensible defaults. [inferred from "autodiscovery" + LiteLLM capabilities]
4. **Configuration via environment:** `LITELLM_BASE_URL` (required) and `LITELLM_API_KEY` (optional) must be supported. [inferred from standard practice]
5. **Optional config overrides:** Support a `.pi/litellm.json` config file for per-model override of discovered metadata (costs, context window, reasoning flags, input types). [inferred from practical need]
6. **Heuristic model classification:** Auto-detect vision support (`["text", "image"]`) and reasoning support from model name patterns when metadata is unavailable. [inferred from usability]
7. **Pi package format:** Must be installable via `pi install git:github.com/andrewhowdencom/pi.litellm`. [inferred from distribution need]
8. **Documentation:** README must cover installation, env var setup, config file format, and usage examples. [inferred from standard practice]

## Task Breakdown

### Task 1: Bootstrap Project Structure
- **Goal:** Create the foundational package structure with package.json, TypeScript configuration, and directory layout.
- **Dependencies:** None.
- **Files Affected:** None (new project).
- **New Files:**
  - `package.json` — Pi package manifest, dependencies, scripts
  - `tsconfig.json` — TypeScript config for IDE support (jiti handles runtime, but tsconfig helps editors)
  - `extensions/index.ts` — Extension entry point (stub)
  - `src/` directory — Source modules
- **Interfaces:** None.
- **Details:**
  - `package.json` must include `"pi": { "extensions": ["./extensions/index.ts"] }`
  - Add `keywords: ["pi-package"]` for npm discoverability
  - Peer dependencies: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `typebox` (with `"*"` range, per Pi docs)
  - `type: "module"` for ESM
  - No runtime build step needed (jiti loads TypeScript directly)

### Task 2: Implement Configuration Resolution
- **Goal:** Build the config module that reads environment variables and optional `.pi/litellm.json` overrides.
- **Dependencies:** Task 1.
- **Files Affected:** None.
- **New Files:**
  - `src/config.ts` — Config types and resolver
- **Interfaces:**
  ```typescript
  interface LiteLLMConfig {
    baseUrl: string;
    apiKey?: string;
    modelOverrides?: Record<string, Partial<ProviderModelConfig>>;
  }
  ```
- **Details:**
  - Read `LITELLM_BASE_URL` from environment (required — throw clear error if missing)
  - Read `LITELLM_API_KEY` from environment (optional)
  - Look for `.pi/litellm.json` in current working directory for model overrides
  - Normalize `baseUrl` (ensure no trailing slash, add `/v1` if missing)
  - Validate that `baseUrl` is a valid URL

### Task 3: Implement Model Discovery
- **Goal:** Query LiteLLM endpoints to fetch available models and their metadata.
- **Dependencies:** Task 2.
- **Files Affected:** None.
- **New Files:**
  - `src/model-discovery.ts` — Endpoint querying and response normalization
- **Interfaces:**
  ```typescript
  interface LiteLLMModelInfo {
    id: string;
    name?: string;
    max_tokens?: number;
    max_input_tokens?: number;
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    // ... LiteLLM-specific fields
  }

  async function discoverModels(baseUrl: string, apiKey?: string): Promise<LiteLLMModelInfo[]>;
  ```
- **Details:**
  - **Primary path:** `GET {baseUrl}/model/info` with optional `Authorization: Bearer {apiKey}`
    - Parse response shape: `{ data: [{ model_info: { ... }, litellm_params: { ... } }] }`
    - Extract `id`, `max_tokens`, `max_input_tokens`, costs from nested fields
  - **Fallback path:** If `/model/info` returns 404 or errors, `GET {baseUrl}/models`
    - Parse OpenAI-compatible shape: `{ data: [{ id, object: "model" }] }`
    - Only `id` is available; all other fields will use defaults
  - Handle network errors with clear, actionable error messages
  - Respect `AbortSignal` if Pi provides one through extension context (pass to `fetch`)

### Task 4: Implement Model Metadata Mapping
- **Goal:** Transform discovered LiteLLM model metadata into Pi `ProviderModelConfig` objects with sensible defaults and heuristics.
- **Dependencies:** Task 3.
- **Files Affected:** None.
- **New Files:**
  - `src/model-mapping.ts` — Mapping and heuristic logic
- **Interfaces:**
  ```typescript
  function mapToPiModel(model: LiteLLMModelInfo, overrides?: Partial<ProviderModelConfig>): ProviderModelConfig;
  ```
- **Details:**
  - **Field mapping:**
    - `id` → `id` (required)
    - `name` → `name` (fallback to `id`)
    - `max_input_tokens` or `max_tokens` → `contextWindow` (fallback to `128000`)
    - `max_tokens` → `maxTokens` (fallback to `4096`)
    - `input_cost_per_token` * 1,000,000 → `cost.input` (fallback to `0`)
    - `output_cost_per_token` * 1,000,000 → `cost.output` (fallback to `0`)
    - `cacheRead` / `cacheWrite` costs → `0` (LiteLLM doesn't expose these uniformly)
  - **Heuristic classification from model name/id:**
    - Vision support (`input: ["text", "image"]`): match `/vision|gpt-4o|claude-.*sonnet|gemini|llava/i`
    - Reasoning support (`reasoning: true`): match `/o1|o3|reasoning|thinking|r1|deepseek-r1/i`
    - Default: `input: ["text"], reasoning: false`
  - **Apply user overrides** from config file last (highest priority)
  - Return complete `ProviderModelConfig` for each model

### Task 5: Implement Extension Entry Point
- **Goal:** Wire the config, discovery, and mapping modules into Pi's extension lifecycle.
- **Dependencies:** Task 2, Task 3, Task 4.
- **Files Affected:** `extensions/index.ts` (created in Task 1).
- **New Files:** None.
- **Interfaces:**
  ```typescript
  export default async function (pi: ExtensionAPI): Promise<void>;
  ```
- **Details:**
  - Call `resolveConfig()` to get `baseUrl` and `apiKey`
  - Call `discoverModels(baseUrl, apiKey)` to get model list
  - Map each model through `mapToPiModel()` with optional overrides
  - Call `pi.registerProvider("litellm", { ... })` with:
    - `name: "LiteLLM"`
    - `baseUrl: config.baseUrl`
    - `apiKey: config.apiKey || undefined`
    - `api: "openai-completions"`
    - `models: mappedModels`
    - `authHeader: true` if apiKey is present
  - Handle errors gracefully: if discovery fails, log a clear notification via `ctx.ui.notify` (if available in factory context — otherwise console.error)
  - No custom `streamSimple` — rely on Pi's built-in OpenAI completions streaming

### Task 6: Add Pi Package Manifest and Polish package.json
- **Goal:** Ensure the package is properly structured for `pi install` distribution.
- **Dependencies:** Task 1.
- **Files Affected:** `package.json`.
- **New Files:** None.
- **Interfaces:** None.
- **Details:**
  - Ensure `pi.extensions` points to correct entry file
  - Add `files` field in package.json to include only necessary files for npm publish
  - Add `repository`, `bugs`, `homepage` fields
  - Verify peer dependencies use `"*"` range for Pi core packages
  - Consider adding `video` or `image` gallery metadata per Pi docs

### Task 7: Write README Documentation
- **Goal:** Document installation, configuration, and usage for end users.
- **Dependencies:** Task 5, Task 6.
- **Files Affected:** None.
- **New Files:**
  - `README.md`
- **Interfaces:** None.
- **Details:**
  - **Installation:** `pi install git:github.com/andrewhowdencom/pi.litellm`
  - **Environment variables:** `LITELLM_BASE_URL` (required), `LITELLM_API_KEY` (optional)
  - **Optional config file:** `.pi/litellm.json` format with example overrides
  - **Usage:** `pi --provider litellm --model <model-id>` or `/model` in interactive mode
  - **Autodiscovery explanation:** What endpoints are queried and how defaults work
  - **Troubleshooting:** Common errors (missing base URL, proxy unreachable, no models found)

### Task 8: Define Testing Strategy
- **Goal:** Establish how the extension is validated without requiring a live LiteLLM proxy.
- **Dependencies:** Task 5.
- **Files Affected:** None.
- **New Files:**
  - `test/fixtures/` — Mock `/model/info` and `/v1/models` JSON responses
  - `test/manual-test.md` — Step-by-step manual testing instructions
- **Interfaces:** None.
- **Details:**
  - **Unit-ish testing:** Since Pi extensions run via jiti in Pi's runtime, traditional unit tests are limited. Instead:
    - Create mock JSON fixtures for both `/model/info` and `/v1/models` responses
    - Test locally by pointing `LITELLM_BASE_URL` at a local HTTP server serving fixtures
  - **Manual testing checklist:**
    1. Start a LiteLLM proxy (or mock server) with known models
    2. Set `LITELLM_BASE_URL` and run `pi --list-models`
    3. Verify all expected models appear with correct IDs
    4. Run `pi --provider litellm --model <id> -p "Hello"` to verify chat works
    5. Test fallback: block `/model/info` and verify `/v1/models` fallback works
    6. Test config overrides: create `.pi/litellm.json` and verify overrides apply
  - **Integration with Pi test suites:** The `docs/custom-provider.md` recommends copying test files from `packages/ai/test/`. Since we use built-in `openai-completions` streaming, those tests are implicitly covered by Pi's own OpenAI provider tests. Manual verification of model registration and a single chat round-trip is sufficient.

## Dependency Graph

- Task 1 → Task 2 (Task 2 depends on project structure)
- Task 2 → Task 3 (Task 3 needs config to know where to query)
- Task 3 → Task 4 (Task 4 needs discovered models to map)
- Task 4 → Task 5 (Task 5 needs mapped models to register)
- Task 5 → Task 7 (README needs complete implementation to document)
- Task 1 → Task 6 (Task 6 polishes manifest created in Task 1)
- Task 5 → Task 8 (Testing validates the complete extension)
- Task 6 || Task 7 || Task 8 (These are parallelizable once Task 5 is complete)

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| LiteLLM `/model/info` endpoint unavailable or returns unexpected shape | Medium | Medium | Implement robust fallback to `/v1/models`; validate response shape before accessing nested fields; use TypeScript type guards |
| LiteLLM proxy requires auth but `LITELLM_API_KEY` not set | Medium | Low | Clear error message at startup; document auth requirement in README |
| Discovered model IDs conflict with built-in Pi providers | Low | Low | Use provider prefix `litellm/<model-id>`; Pi's `registerProvider` namespaces by provider name |
| Cost metadata missing from LiteLLM response | Low | High | Default to 0 costs (shown as "unknown" in Pi UI); allow user override via config file |
| Vision/reasoning heuristics misclassify models | Low | Medium | Config file overrides allow manual correction; heuristic patterns are conservative (default to false) |
| Pi extension API changes in future versions | Medium | Low | Use `"*"` peer dependency range; follow Pi's documented patterns; monitor Pi changelog |
| jiti resolution issues with `node_modules` in extension directory | Low | Low | Follow `with-deps` example structure; ensure `npm install` is run in extension directory if deps added |

## Validation Criteria

- [ ] `pi --list-models` shows all models from the LiteLLM proxy with `litellm/` prefix
- [ ] `pi --provider litellm --model <discovered-id> -p "test"` successfully sends a chat completion and receives a response
- [ ] Extension works with `LITELLM_BASE_URL` env var alone (no API key) for unauthenticated proxies
- [ ] Extension sends `Authorization: Bearer` header when `LITELLM_API_KEY` is set
- [ ] When `/model/info` is available, model context windows and costs are populated (not all zeros/defaults)
- [ ] When `/model/info` is unavailable (404), extension falls back to `/v1/models` and registers models with sensible defaults
- [ ] `.pi/litellm.json` config file overrides are applied to discovered models
- [ ] `pi install git:github.com/andrewhowdencom/pi.litellm` successfully loads the extension on next Pi startup
- [ ] README contains working installation and configuration instructions
- [ ] No custom `streamSimple` implementation exists (provider uses built-in `openai-completions`)

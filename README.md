# pi.litellm

[![CI](https://github.com/andrewhowdencom/pi.litellm/actions/workflows/ci.yml/badge.svg)](https://github.com/andrewhowdencom/pi.litellm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Pi extension that adds [LiteLLM](https://docs.litellm.ai/docs/) as a first-class provider with **automatic model discovery**. Point it at your LiteLLM proxy and all configured models appear in Pi's `/model` selector — no manual enumeration required.

## Installation

Install as a Pi package from git:

```bash
pi install git:github.com/andrewhowdencom/pi.litellm
```

> The npm package name is `pi-litellm`.

Or load temporarily for a single session:

```bash
pi -e git:github.com/andrewhowdencom/pi.litellm
```

## Configuration

### `settings.json`

Add the extension settings to your Pi `settings.json`. The extension reads from two locations, with project-local overriding global:

**Global defaults** (`~/.pi/agent/settings.json`):
```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:4000",
    "apiKey": "sk-..."
  }
}
```

**Project-local overrides** (`./.pi/settings.json`):
```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://project-proxy:4000"
  }
}
```

The extension normalizes the URL automatically (adds `/v1` if missing, strips trailing slashes).

When `apiKey` is set, the extension sends `Authorization: Bearer <key>` with every request.

### Optional per-model overrides (`./.pi/litellm.json`)

Create `.pi/litellm.json` in your project directory to override discovered metadata for specific models:

```json
{
  "modelOverrides": {
    "gpt-4": {
      "contextWindow": 8192,
      "maxTokens": 4096,
      "cost": {
        "input": 30,
        "output": 60
      }
    },
    "claude-sonnet-4": {
      "reasoning": true,
      "input": ["text", "image"]
    }
  }
}
```

Available override fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name shown in Pi's model selector |
| `reasoning` | `boolean` | Whether the model supports extended thinking |
| `input` | `["text"]` or `["text", "image"]` | Supported input modalities |
| `cost.input` | `number` | Input cost per million tokens ($) |
| `cost.output` | `number` | Output cost per million tokens ($) |
| `cost.cacheRead` | `number` | Cache read cost per million tokens ($) |
| `cost.cacheWrite` | `number` | Cache write cost per million tokens ($) |
| `contextWindow` | `number` | Maximum context window in tokens |
| `maxTokens` | `number` | Maximum output tokens |

## Usage

### Interactive mode

Start Pi and select a LiteLLM model with `/model` or `Ctrl+L`:

```bash
pi
```

Then type `/model` and search for models prefixed with `litellm/`.

### Print mode (one-shot)

```bash
pi --provider litellm --model gpt-4 -p "Summarize this codebase"
```

### With API key

Ensure `apiKey` is set in your `settings.json`, then:

```bash
pi --provider litellm --model claude-sonnet-4 -p "Refactor this function"
```

## How autodiscovery works

At startup, the extension queries your LiteLLM proxy in two phases. `{baseUrl}` below refers to your `LITELLM_BASE_URL` after normalization — it always ends with `/v1`.

1. **Authoritative list:** `GET {baseUrl}/models` — the OpenAI-compatible list endpoint. This is **key-scoped**: it returns exactly the model aliases your API key is entitled to call, with no duplicate per-deployment rows and no tag-gated entries you cannot reach. It defines *which* models appear in the picker.

2. **Metadata enrichment:** `GET {baseUrl}/model/info` — LiteLLM's rich metadata endpoint. Its context windows, token limits, and per-token costs are merged onto the authoritative models (joined by `model_name`). This step is best-effort: if `/model/info` returns 404, errors, or is malformed, the extension keeps the key-scoped list and applies sensible defaults for the missing metadata.

> Only models returned by `/models` are shown, so you never see a model your key cannot use. This avoids the "not allowed access to model due to tags configuration" error that occurs when a proxy fronts one alias with multiple tag-scoped deployments.

### Sensible defaults

When metadata is missing, the extension applies these defaults:

| Field | Default | Rationale |
|-------|---------|-----------|
| `contextWindow` | `128000` | Common default for modern models |
| `maxTokens` | `4096` | Conservative output limit |
| `cost.*` | `0` | Unknown costs show as "—" in Pi UI |
| `input` | `["text"]` | Safe default; image support detected heuristically |
| `reasoning` | `false` | Safe default; detected heuristically from model name |

### Heuristic model classification

When LiteLLM does not expose capability metadata, the extension guesses from the model ID:

- **Vision support** (`input: ["text", "image"]`): triggered by IDs containing `vision`, `gpt-4o`, `claude-.*sonnet`, `gemini`, or `llava`.
- **Reasoning support** (`reasoning: true`): triggered by IDs matching `o1`, `o3`, `reasoning`, `thinking`, `r1`, or `deepseek-r1`.

These are conservative defaults. Use `.pi/litellm.json` overrides to correct misclassified models.

## Architecture

```
Pi startup
    │
    ▼
Async extension factory loads
    │
    ├─► Read config (settings.json + optional .pi/litellm.json)
    │
    ├─► Fetch /models (authoritative, key-scoped list)
    │   └─► Defines which models are shown
    │
    ├─► Fetch /model/info (best-effort enrichment)
    │   └─► Merge costs, context windows, token limits by model_name
    │   └─► On failure: keep list, apply defaults for metadata
    │
    ├─► Map each model to Pi ProviderModelConfig
    │   └─► Apply defaults for missing fields
    │   └─► Apply user overrides from config file
    │
    └─► pi.registerProvider("litellm", { ... })
```

The extension uses Pi's built-in `openai-completions` streaming API — **no custom streaming logic** is required because LiteLLM is natively OpenAI-compatible.

## Troubleshooting

### `LiteLLM baseUrl is required`

Add the extension configuration to your Pi `settings.json`:

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:4000"
  }
}
```

Place it in `~/.pi/agent/settings.json` for global defaults, or `./.pi/settings.json` for project-local configuration.

### `No models discovered from LiteLLM proxy`

- Verify your LiteLLM proxy is running and accessible at the configured `baseUrl`.
- Check that the proxy has at least one model configured in its `config.yaml`.
- If authentication is required, set `apiKey` in your `settings.json`.

### Models appear with `contextWindow: 128000` and `cost: 0`

Your LiteLLM proxy is not exposing the `/model/info` endpoint (common with older versions or minimal deployments), so metadata enrichment is skipped. The authoritative `/v1/models` list still populates the picker, but with default context windows and costs. Upgrade LiteLLM or add per-model overrides in `.pi/litellm.json`.

### `Failed to fetch models from LiteLLM: ...`

- Check network connectivity to the proxy.
- Verify the base URL is correct (try `curl http://localhost:4000/v1/models`, adjusting for your proxy URL).
- If using HTTPS with a self-signed certificate, ensure your Node.js environment trusts the certificate.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type-check and test
npm run check

# Type-check only
npm run build
```

## Requirements

- [Pi](https://pi.dev) ≥ 0.72 (for `registerProvider` API)
- [LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) with at least `/v1/models` exposed
- `/model/info` endpoint recommended for rich metadata enrichment (costs, context windows)
- Peer dependencies (provided by Pi): `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `typebox`

## Support

Report issues at [github.com/andrewhowdencom/pi.litellm/issues](https://github.com/andrewhowdencom/pi.litellm/issues).

## License

MIT

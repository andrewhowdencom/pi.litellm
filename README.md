# pi.litellm

Pi extension that adds [LiteLLM](https://docs.litellm.ai/docs/) as a first-class provider with **automatic model discovery**. Point it at your LiteLLM proxy and all configured models appear in Pi's `/model` selector — no manual enumeration required.

## Installation

Install as a Pi package from git:

```bash
pi install git:github.com/andrewhowdencom/pi.litellm
```

Or load temporarily for a single session:

```bash
pi -e git:github.com/andrewhowdencom/pi.litellm
```

## Configuration

### Required environment variable

```bash
export LITELLM_BASE_URL=http://localhost:4000   # your LiteLLM proxy URL
```

The extension normalizes the URL automatically (adds `/v1` if missing, strips trailing slashes).

### Optional environment variable

```bash
export LITELLM_API_KEY=sk-...   # if your LiteLLM proxy requires authentication
```

When set, the extension sends `Authorization: Bearer <key>` with every request.

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
export LITELLM_BASE_URL=http://localhost:4000
pi
```

Then type `/model` and search for models prefixed with `litellm/`.

### Print mode (one-shot)

```bash
export LITELLM_BASE_URL=http://localhost:4000
pi --provider litellm --model gpt-4 -p "Summarize this codebase"
```

### With API key

```bash
export LITELLM_BASE_URL=https://litellm.internal.company.com
export LITELLM_API_KEY=sk-...
pi --provider litellm --model claude-sonnet-4 -p "Refactor this function"
```

## How autodiscovery works

At startup, the extension queries your LiteLLM proxy in two phases:

1. **Primary:** `GET {baseUrl}/model/info` — LiteLLM's rich metadata endpoint. Returns model IDs, context windows, token limits, and per-token costs when available.

2. **Fallback:** If `/model/info` returns 404 or errors, `GET {baseUrl}/v1/models` — OpenAI-compatible minimal list. Only model IDs are available; all other metadata uses sensible defaults.

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
    ├─► Read config (env vars + optional .pi/litellm.json)
    │
    ├─► Fetch /model/info (rich metadata)
    │   └─► On success: extract costs, context windows, token limits
    │
    ├─► On failure: fetch /v1/models (minimal list)
    │   └─► Only model IDs available
    │
    ├─► Map each model to Pi ProviderModelConfig
    │   └─► Apply defaults for missing fields
    │   └─► Apply user overrides from config file
    │
    └─► pi.registerProvider("litellm", { ... })
```

The extension uses Pi's built-in `openai-completions` streaming API — **no custom streaming logic** is required because LiteLLM is natively OpenAI-compatible.

## Troubleshooting

### `LITELLM_BASE_URL environment variable is required`

Set the environment variable before starting Pi:

```bash
export LITELLM_BASE_URL=http://localhost:4000
```

### `No models discovered from LiteLLM proxy`

- Verify your LiteLLM proxy is running and accessible at `LITELLM_BASE_URL`.
- Check that the proxy has at least one model configured in its `config.yaml`.
- If authentication is required, set `LITELLM_API_KEY`.

### Models appear with `contextWindow: 128000` and `cost: 0`

Your LiteLLM proxy is not exposing the `/model/info` endpoint (common with older versions or minimal deployments). The extension falls back to `/v1/models`, which only returns model IDs. All other fields use defaults. Upgrade LiteLLM or add per-model overrides in `.pi/litellm.json`.

### `Failed to fetch models from LiteLLM: ...`

- Check network connectivity to the proxy.
- Verify the base URL is correct (try `curl $LITELLM_BASE_URL/v1/models`).
- If using HTTPS with a self-signed certificate, ensure your Node.js environment trusts the certificate.

## Requirements

- [Pi](https://pi.dev) ≥ 0.72 (for `registerProvider` API)
- [LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) with at least `/v1/models` exposed
- `/model/info` endpoint recommended for rich metadata (costs, context windows)

## License

MIT

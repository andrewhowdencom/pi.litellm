# LiteLLM Provider

[Pi extension](https://github.com/andrewhowdencom/pi.litellm) that adds [LiteLLM](https://docs.litellm.ai/) as a first-class provider with **automatic model discovery**. Point it at your LiteLLM proxy and all configured models appear in Pi's `/model` selector — no manual enumeration required.

## Installation

Install as a Pi package from git:

```bash
pi install git:github.com/andrewhowdencom/pi.litellm
```

Or load temporarily for a single session:

```bash
pi -e git:github.com/andrewhowdencom/pi.litellm
```

## Quick Start

1. Configure your LiteLLM proxy URL in `~/.pi/agent/settings.json`:

    ```json
    {
      "github.com/andrewhowdencom/pi.litellm": {
        "baseUrl": "http://localhost:4000",
        "apiKey": "sk-..."
      }
    }
    ```

2. Start Pi and select a LiteLLM model with `/model`.

3. Search for models prefixed with `litellm/`.

## Configuration

### Global defaults (`~/.pi/agent/settings.json`)

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:4000",
    "apiKey": "sk-..."
  }
}
```

### Project-local overrides (`./.pi/settings.json`)

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://project-proxy:4000"
  }
}
```

The extension normalizes the URL automatically (adds `/v1` if missing, strips trailing slashes). When `apiKey` is set, the extension sends `Authorization: Bearer <key>` with every request.

### Optional per-model overrides (`./.pi/litellm.json`)

Create `.pi/litellm.json` in your project directory to override discovered metadata:

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
| `name` | `string` | Display name in Pi's model selector |
| `reasoning` | `boolean` | Supports extended thinking |
| `input` | `["text"]` or `["text", "image"]` | Supported input modalities |
| `cost.input` | `number` | Input cost per million tokens ($) |
| `cost.output` | `number` | Output cost per million tokens ($) |
| `cost.cacheRead` | `number` | Cache read cost per million tokens ($) |
| `cost.cacheWrite` | `number` | Cache write cost per million tokens ($) |
| `contextWindow` | `number` | Maximum context window in tokens |
| `maxTokens` | `number` | Maximum output tokens |

## Usage

### Interactive mode

```bash
pi
```

Then `/model` and search for `litellm/` prefixed models.

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

At startup, the extension queries your LiteLLM proxy in two phases:

1. **Primary:** `GET {baseUrl}/model/info` — rich metadata endpoint returning model IDs, context windows, token limits, and costs.
2. **Fallback:** If `/model/info` returns 404 or errors, `GET {baseUrl}/models` — OpenAI-compatible minimal list. Only model IDs are available; defaults apply for all other metadata.

### Sensible defaults

| Field | Default | Rationale |
|-------|---------|-----------|
| `contextWindow` | `128000` | Common default for modern models |
| `maxTokens` | `4096` | Conservative output limit |
| `cost.*` | `0` | Unknown costs shown as "—" in Pi UI |
| `input` | `["text"]` | Safe default; image support detected heuristically |
| `reasoning` | `false` | Safe default; detected heuristically from model name |

### Heuristic model classification

- **Vision support**: triggered by IDs containing `vision`, `gpt-4o`, `claude-.*sonnet`, `gemini`, or `llava`.
- **Reasoning support**: triggered by IDs matching `o1`, `o3`, `reasoning`, `thinking`, `r1`, or `deepseek-r1`.

Use `.pi/litellm.json` overrides to correct misclassified models.

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

### `No models discovered from LiteLLM proxy`

- Verify your LiteLLM proxy is running and accessible at the configured `baseUrl`.
- Check that the proxy has at least one model configured in its `config.yaml`.
- If authentication is required, set `apiKey` in your `settings.json`.

### Models appear with `contextWindow: 128000` and `cost: 0`

Your proxy is not exposing `/model/info`. The extension falls back to `/v1/models`, which only returns model IDs. Upgrade LiteLLM or add per-model overrides in `.pi/litellm.json`.

### `Failed to fetch models from LiteLLM`

- Check network connectivity to the proxy.
- Verify the base URL is correct (`curl http://localhost:4000/v1/models`).
- If using HTTPS with a self-signed certificate, ensure your Node.js environment trusts the certificate.

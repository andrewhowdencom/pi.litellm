# Manual Testing Guide

Since Pi extensions run inside Pi's jiti runtime, traditional unit tests are not practical. Instead, validate the extension by pointing it at mock or real LiteLLM endpoints.

## Quick test with mock fixtures

You can serve the fixture files with any HTTP server and point `LITELLM_BASE_URL` at it.

### Using Python's built-in HTTP server

```bash
cd test/fixtures
python3 -m http.server 9999 &
```

Create `./.pi/settings.json` in your working directory:

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:9999"
  }
}
```

Then run Pi:

```bash
pi --list-models
```

> **Note:** This is a minimal test. The mock fixtures are static JSON files, so `/model/info` and `/v1/models` will be served from the same directory. In a real LiteLLM proxy, `/model/info` is a dynamic endpoint. For a more realistic test, use the Node mock server below.

### Using a Node.js mock LiteLLM server

Create a temporary `mock-server.mjs`:

```javascript
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const modelInfo = JSON.parse(readFileSync("./fixtures/model-info.json", "utf-8"));
const modelsList = JSON.parse(readFileSync("./fixtures/models-list.json", "utf-8"));

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/model/info") {
    res.writeHead(200);
    res.end(JSON.stringify(modelInfo));
  } else if (req.url === "/v1/models") {
    res.writeHead(200);
    res.end(JSON.stringify(modelsList));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(9999, () => {
  console.log("Mock LiteLLM server on http://localhost:9999");
});
```

Run it:

```bash
node mock-server.mjs
```

In another terminal (with `./.pi/settings.json` configured as above):

```bash
pi --list-models
```

You should see four models: `litellm/gpt-4`, `litellm/claude-sonnet-4`, `litellm/gpt-4o`, `litellm/deepseek-r1`.

## Test checklist

### 1. Model discovery with rich metadata

Ensure `./.pi/settings.json` points at the mock server:

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:9999"
  }
}
```

```bash
pi --list-models
```

**Expected:** Four models appear. Verify that:
- `litellm/gpt-4` has `contextWindow: 8192` (from `max_input_tokens`)
- `litellm/claude-sonnet-4` has `contextWindow: 200000`
- `litellm/gpt-4o` is marked with vision support (`input: ["text", "image"]`)
- `litellm/deepseek-r1` is marked with `reasoning: true`

### 2. Chat completion round-trip

```bash
pi --provider litellm --model gpt-4 -p "What is 2+2?"
```

> **Note:** This assumes `./.pi/settings.json` is already configured.

> **Note:** This test requires a real LiteLLM proxy or a mock that also implements `/v1/chat/completions`. The fixture server above only serves model lists.

### 3. Fallback to `/v1/models`

Block the `/model/info` endpoint and verify fallback behavior:

```javascript
// mock-server-fallback.mjs
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/model/info") {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  } else if (req.url === "/v1/models") {
    res.writeHead(200);
    res.end(JSON.stringify(modelsList));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});
```

```bash
pi --list-models
```

**Expected:** All four models appear, but all have `contextWindow: 128000` (default) and `cost: 0` (default) since the minimal `/v1/models` response has no metadata.

### 4. Config file overrides

Create `.pi/litellm.json` in your working directory:

```json
{
  "modelOverrides": {
    "gpt-4": {
      "contextWindow": 32768,
      "cost": {
        "input": 30,
        "output": 60
      }
    }
  }
}
```

```bash
pi --list-models
```

**Expected:** `litellm/gpt-4` shows `contextWindow: 32768` and `cost.input: 30`, overriding the discovered `8192` and `30` (which are the same here, but the override takes priority).

### 5. Missing `baseUrl`

Remove or rename `./.pi/settings.json` and ensure `~/.pi/agent/settings.json` does not contain the extension key.

```bash
mv .pi/settings.json .pi/settings.json.bak
pi
```

**Expected:** A console warning appears: `[pi-litellm] Configuration error: LiteLLM baseUrl is required...`

### 6. Authenticated proxy

Set an API key in `./.pi/settings.json` and verify the `Authorization: Bearer` header is sent:

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://localhost:9999",
    "apiKey": "sk-test-12345"
  }
}
```

```javascript
// mock-server-auth.mjs
const server = createServer((req, res) => {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer sk-test")) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  // ...serve models
});
```

```bash
pi --list-models
```

**Expected:** Models appear only when the correct key is provided; 401 error when the key is wrong or missing.

## Real LiteLLM proxy test

If you have a running LiteLLM proxy, add it to `~/.pi/agent/settings.json`:

```json
{
  "github.com/andrewhowdencom/pi.litellm": {
    "baseUrl": "http://your-litellm-proxy:4000",
    "apiKey": "your-key"
  }
}
```

Then test:

```bash
# List discovered models
pi --list-models

# Start interactive session
pi --provider litellm --model <discovered-id>
```

## Notes

- Pi extensions are loaded via [jiti](https://github.com/unjs/jiti), so TypeScript files run directly without compilation.
- The `openai-completions` streaming implementation is built into Pi; this extension does not implement custom streaming.
- Model registration happens during the async factory phase, before Pi's interactive TUI starts. If discovery fails, the provider is not registered and a console warning is emitted.

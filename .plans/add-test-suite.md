# Plan: Add Test Suite and Improve Testability

## Objective

Introduce a comprehensive automated test suite for the `pi.litellm` extension, addressing the complete absence of unit and integration tests in commit `9d4a23b`. The plan prioritizes high-value pure-function tests (heuristics, mapping, math utilities) as quick wins, then systematically refactors hard-coded global dependencies (`fetch`, `process.env`, `fs`) behind injectable seams to enable integration testing of the discovery, config, and extension entry-point layers. Finally, it wires everything into a CI pipeline for regression prevention.

## Context

Commit `9d4a23b` added four source modules (`src/config.ts`, `src/model-discovery.ts`, `src/model-mapping.ts`, `extensions/index.ts`) and a package manifest with **zero automated tests**. The `package.json` scripts explicitly opt out of validation (`"check": "echo 'nothing to check...'"`). Two static JSON fixtures (`test/fixtures/model-info.json`, `test/fixtures/models-list.json`) and a `test/manual-test.md` guide exist, but provide no executable assertions.

A detailed testability audit identified:
- **Pure functions** (`hasVisionSupport`, `hasReasoningSupport`, `mapToPiModel`, `costPerMillion`, `clampPositiveInt`) are highly testable but completely untested.
- **HTTP discovery layer** (`fetchModelInfo`, `fetchModelsList`, `discoverModels`) is untestable because `fetch` is hard-coded as a global.
- **Config resolution layer** (`resolveConfig`, `loadConfigFile`) is untestable because `process.env`, `process.cwd()`, and `readFileSync` are accessed directly.
- **Extension entry point** (`extensions/index.ts`) mixes side effects (logging, provider registration) with orchestration logic and has no test coverage.

## Architectural Blueprint

**Selected approach: Incremental testability improvement via Vitest + dependency injection.**

### Test Runner Selection (Tree-of-Thought)

| Path | Description | Pros | Cons | Verdict |
|------|-------------|------|------|---------|
| A — Node.js built-in test runner (`node:test`) | Zero dependencies, native since Node 18+ | No extra packages | Poor ESM/TypeScript ergonomics, manual mocking, no watch mode | Rejected |
| B — Jest | Mature ecosystem | Wide plugin support | ESM support is flaky, requires complex config for `"type": "module"` + NodeNext | Rejected |
| C — Vitest | Modern Vite-based test runner | Native ESM/TypeScript, excellent mocking, built-in coverage, watch mode, aligns with project's ESM setup | Adds one dev dependency | **Selected** |

### DI Strategy

- **Path A** — Pass `fetch` as a parameter to every function. Simple but clutters signatures.
- **Path B** — Create an `HttpClient` interface. More abstract than needed for this small codebase.
- **Path C** — Accept an optional `fetchImpl` parameter (defaulting to `globalThis.fetch`). Minimal change, maximal testability.

**Selected**: Path C for `fetch`, and an analogous `{ env, readFile, cwd }` options bag for config resolution.

### Phases

1. **Phase 1 — Pure-function unit tests**: Test `model-mapping.ts` and validator type guards without any refactoring.
2. **Phase 2 — DI refactoring**: Make `fetch`, `process.env`, and `fs` injectable in `model-discovery.ts` and `config.ts`.
3. **Phase 3 — Integration tests**: Test fallback chains, config edge cases, and the extension entry point using the new seams.
4. **Phase 4 — CI automation**: GitHub Actions workflow running `npm test`.

## Requirements

1. Configure Vitest as the test runner with TypeScript/ESM support matching the project's `tsconfig.json`. [inferred from project stack]
2. Add unit tests for all pure utility functions in `src/model-mapping.ts`. [from audit: CRITICAL gap]
3. Add unit tests for response shape validators in `src/model-discovery.ts`. [from audit: MEDIUM gap]
4. Refactor `src/model-discovery.ts` to accept an injectable `fetch` function. [from audit: required for integration testing]
5. Refactor `src/config.ts` to accept injectable `env` and `readFile` dependencies. [from audit: required for integration testing]
6. Add integration tests for the discovery fallback chain (`/model/info` → `/v1/models`). [from audit: CRITICAL gap]
7. Add integration tests for config resolution edge cases. [from audit: HIGH gap]
8. Add an integration test for the extension entry point wiring. [from audit: MEDIUM gap]
9. Add a GitHub Actions CI workflow to run tests automatically. [from audit: infrastructure gap]
10. Update `package.json` scripts to run real commands instead of no-op `echo` statements. [from audit: infrastructure gap]
11. Preserve the existing `test/fixtures/` JSON files for both automated and manual testing. [inferred]

## Task Breakdown

### Task 1: Configure Vitest Test Runner
- **Goal**: Install and configure Vitest as the project's test runner.
- **Dependencies**: None.
- **Files Affected**: `package.json`.
- **New Files**: `vitest.config.ts`.
- **Interfaces**: None.
- **Details**: Add `vitest` as a dev dependency in `package.json`. Create `vitest.config.ts` with ESM and TypeScript settings matching the project's `tsconfig.json` (`module: "NodeNext"`, `target: "ES2022"`). Update `package.json` scripts: replace the `check` no-op with real test and type-check scripts (e.g., `"test": "vitest run"`, `"test:watch": "vitest"`). Remove or repurpose the `build` and `clean` no-op scripts — consider `"build": "tsc --noEmit"` for type-checking even though jiti handles runtime.

### Task 2: Add Unit Tests for Model Mapping Utilities
- **Goal**: Cover all pure functions in `src/model-mapping.ts` with table-driven unit tests.
- **Dependencies**: Task 1.
- **Files Affected**: `src/model-mapping.ts` (read-only, to understand expected behavior).
- **New Files**: `test/model-mapping.test.ts`.
- **Interfaces**: None.
- **Details**: Write Vitest tests for:
  - `hasVisionSupport`: table of model IDs → expected boolean. Include exact matches (`gpt-4o`), substring matches (`gemini-1.5-vision`), false positives (`my-o1-model` must NOT match vision), case sensitivity, and newly released model names.
  - `hasReasoningSupport`: similar table covering `o1`, `o3`, `reasoning`, `thinking`, `r1`, `deepseek-r1`, and negative cases.
  - `costPerMillion`: boundary values (`undefined`, `null`, `NaN`, `0`, positive, very large).
  - `clampPositiveInt`: boundary values (`undefined`, `null`, `NaN`, `-1`, `0`, positive, very large).
  - `mapToPiModel`: comprehensive table with `{ input: LiteLLMModelInfo, overrides: ModelOverrides | undefined, expected: PiModelConfig }` covering full overrides, partial overrides, no overrides, missing metadata fields, heuristic classification, and cost scaling correctness. Use `test/fixtures/model-info.json` as a source of realistic inputs.

### Task 3: Add Unit Tests for Response Shape Validators
- **Goal**: Cover `isValidModelInfoResponse` and `isValidModelsResponse` with unit tests.
- **Dependencies**: Task 1.
- **Files Affected**: `src/model-discovery.ts` (read-only).
- **New Files**: `test/validators.test.ts`.
- **Interfaces**: None.
- **Details**: Write Vitest tests with a table of valid and invalid JSON-like objects:
  - Valid: exact expected shape, extra fields, empty `data` array.
  - Invalid: missing `data`, `data` not an array, `null` root, primitive root, `data` array with non-object elements.
  - Assert the type guard returns `true`/`false` correctly.

### Task 4: Refactor Model Discovery for Injectable Fetch
- **Goal**: Replace the hard-coded global `fetch` with an injectable parameter so tests can control HTTP responses.
- **Dependencies**: Task 1.
- **Files Affected**: `src/model-discovery.ts`.
- **New Files**: None.
- **Interfaces**: Modified signatures:
  ```typescript
  async function fetchModelInfo(
    baseUrl: string,
    apiKey?: string,
    signal?: AbortSignal,
    fetchImpl?: typeof globalThis.fetch,
  ): Promise<LiteLLMModelInfo[] | null>;

  async function fetchModelsList(
    baseUrl: string,
    apiKey?: string,
    signal?: AbortSignal,
    fetchImpl?: typeof globalThis.fetch,
  ): Promise<LiteLLMModelInfo[]>;

  export async function discoverModels(
    baseUrl: string,
    apiKey?: string,
    signal?: AbortSignal,
    fetchImpl?: typeof globalThis.fetch,
  ): Promise<LiteLLMModelInfo[]>;
  ```
- **Details**: Add an optional `fetchImpl` parameter to `fetchModelInfo`, `fetchModelsList`, and `discoverModels`. Default each to `globalThis.fetch`. Replace every call to `fetch(` with `fetchImpl(`. Pass `fetchImpl` through the call chain so `discoverModels` delegates to both sub-functions correctly. Ensure `buildHeaders` and response parsing logic remain unchanged.

### Task 5: Refactor Config Resolution for Injectable Dependencies
- **Goal**: Replace hard-coded `process.env`, `process.cwd()`, and `readFileSync` with injectable parameters.
- **Dependencies**: Task 1.
- **Files Affected**: `src/config.ts`.
- **New Files**: None.
- **Interfaces**: Modified signatures:
  ```typescript
  export function resolveConfig(deps?: {
    env?: NodeJS.ProcessEnv;
    readFile?: (path: string, encoding: string) => string;
    cwd?: () => string;
  }): LiteLLMConfig;

  function loadConfigFile(deps?: {
    readFile?: (path: string, encoding: string) => string;
    cwd?: () => string;
  }): Record<string, ModelOverrides> | undefined;
  ```
- **Details**: Add an optional `deps` parameter bag to `resolveConfig` and `loadConfigFile`. Default `env` to `process.env`, `readFile` to `node:fs/readFileSync`, `cwd` to `process.cwd`. Replace all direct references to `process.env.LITELLM_BASE_URL`, `process.env.LITELLM_API_KEY`, `readFileSync(...)`, and `process.cwd()` with the corresponding parameter. Ensure error messages and normalization logic remain unchanged.

### Task 6: Add Integration Tests for Discovery Fallback Chain
- **Goal**: Verify the `/model/info` → `/v1/models` fallback behavior under all error conditions.
- **Dependencies**: Task 4.
- **Files Affected**: `src/model-discovery.ts` (read-only).
- **New Files**: `test/model-discovery.test.ts`.
- **Interfaces**: Uses the refactored `discoverModels(baseUrl, apiKey, signal, fetchImpl)` signature.
- **Details**: Write Vitest tests that create a mock `fetchImpl` function (Vitest `vi.fn()`):
  - `/model/info` returns 404 → asserts `/v1/models` is called and results are returned.
  - `/model/info` returns 500 → asserts fallback to `/v1/models`.
  - `/model/info` returns 200 but invalid JSON shape → asserts fallback to `/v1/models`.
  - `/model/info` returns 200 with valid rich metadata → asserts fallback is NOT called and rich metadata is returned.
  - `/model/info` network error (non-Abort) → asserts fallback to `/v1/models`.
  - `AbortSignal` triggered on `/model/info` → asserts `AbortError` is re-thrown (NOT fallback).
  - Both endpoints fail → asserts the thrown error contains the `/v1/models` failure message.
  - Use `test/fixtures/model-info.json` and `test/fixtures/models-list.json` as mock response bodies.

### Task 7: Add Integration Tests for Config Resolution
- **Goal**: Verify config resolution edge cases without modifying global `process.env` or filesystem.
- **Dependencies**: Task 5.
- **Files Affected**: `src/config.ts` (read-only).
- **New Files**: `test/config.test.ts`.
- **Interfaces**: Uses the refactored `resolveConfig(deps)` and `loadConfigFile(deps)` signatures.
- **Details**: Write Vitest tests:
  - Missing `LITELLM_BASE_URL` → asserts `Error` is thrown with the exact expected message.
  - Valid `LITELLM_BASE_URL` without trailing slash → asserts normalized URL ends with `/v1`.
  - Valid `LITELLM_BASE_URL` with trailing slash → asserts no double slashes.
  - `LITELLM_BASE_URL` already ending in `/v1` → asserts no double `/v1/v1`.
  - Invalid URL → asserts `Error` is thrown.
  - Missing `.pi/litellm.json` (ENOENT) → asserts `modelOverrides` is `undefined`.
  - Valid `.pi/litellm.json` → asserts `modelOverrides` matches parsed JSON.
  - Invalid JSON in `.pi/litellm.json` → asserts `Error` is thrown with helpful message.
  - `LITELLM_API_KEY` present → asserts it is included in returned config.
  - `LITELLM_API_KEY` absent → asserts it is `undefined`.

### Task 8: Add Integration Test for Extension Entry Point
- **Goal**: Verify the extension factory correctly wires config → discovery → mapping → registration, and handles failures gracefully.
- **Dependencies**: Task 6, Task 7.
- **Files Affected**: `extensions/index.ts` (read-only).
- **New Files**: `test/extension.test.ts`.
- **Interfaces**: Minimal mock for `ExtensionAPI`:
  ```typescript
  interface MockExtensionAPI {
    registerProvider: ReturnType<typeof vi.fn>;
  }
  ```
- **Details**: Write Vitest tests that:
  - Mock `resolveConfig` and `discoverModels` (via the DI-refactored signatures with controlled mocks) to simulate a successful path. Assert `registerProvider` is called with `"litellm"` and a config object containing the expected `baseUrl`, `apiKey`, `api: "openai-completions"`, and `models` array.
  - Simulate `resolveConfig` throwing → assert `registerProvider` is NOT called and an error is logged.
  - Simulate `discoverModels` throwing → assert `registerProvider` is NOT called and an error is logged.
  - Simulate `discoverModels` returning empty array → assert `registerProvider` IS called with an empty `models` array (verify this is the intended behavior observed in the source).
  - Verify the mapped models array contains the expected `PiModelConfig` objects when overrides are present.

### Task 9: Add GitHub Actions CI Workflow
- **Goal**: Automatically run the test suite on every push and pull request.
- **Dependencies**: Task 1.
- **Files Affected**: None.
- **New Files**: `.github/workflows/ci.yml`.
- **Interfaces**: None.
- **Details**: Create a minimal GitHub Actions workflow:
  - Trigger on `push` to `main` and on `pull_request`.
  - Use `ubuntu-latest` runner.
  - Setup Node.js (LTS, e.g., `node-version: 20`).
  - Run `npm ci` (or `npm install` if no lockfile exists).
  - Run `npm test` (invokes `vitest run`).
  - Optionally add a coverage step with `vitest run --coverage` if `@vitest/coverage-v8` is installed.

### Task 10: Update package.json Scripts and Metadata
- **Goal**: Replace no-op scripts with real, meaningful scripts.
- **Dependencies**: Task 1, Task 9.
- **Files Affected**: `package.json`.
- **New Files**: None.
- **Interfaces**: None.
- **Details**: Update `scripts` in `package.json`:
  - `"test": "vitest run"` — runs tests once.
  - `"test:watch": "vitest"` — runs tests in watch mode.
  - `"build": "tsc --noEmit"` — type-checking (jiti handles runtime, but static checking is valuable).
  - `"check": "tsc --noEmit && vitest run"` — comprehensive validation.
  - Add `devDependencies` for `vitest`, `@vitest/coverage-v8` (optional), and `typescript` (if not already present).

## Dependency Graph

- Task 1 → Task 2 (needs Vitest configured)
- Task 1 → Task 3 (needs Vitest configured)
- Task 1 → Task 4 (refactoring can use Vitest for validation)
- Task 1 → Task 5 (refactoring can use Vitest for validation)
- Task 1 → Task 9 (CI needs the test script defined)
- Task 1 → Task 10 (scripts update depends on Vitest being installed)
- Task 4 → Task 6 (integration tests need injectable fetch)
- Task 5 → Task 7 (integration tests need injectable config deps)
- Task 6 → Task 8 (entry point test needs mockable discovery)
- Task 7 → Task 8 (entry point test needs mockable config)
- Task 2 || Task 3 || Task 4 || Task 5 (parallel once Task 1 is complete)
- Task 9 || Task 10 (parallel once Task 1 is complete)

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Vitest ESM/NodeNext resolution issues | Medium | Low | Match `vitest.config.ts` to existing `tsconfig.json` (`module: "NodeNext"`). Run a quick spike (`npx vitest run --reporter=verbose` on a single dummy test) before proceeding with full test suite. |
| Refactoring DI signatures breaks manual-test.md instructions | Low | Medium | DI parameters have defaults (`globalThis.fetch`, `process.env`, etc.) so external callers (jiti runtime, manual tests) are unaffected. Verify by spot-checking manual tests after Tasks 4 and 5. |
| ExtensionAPI type unavailable for mock in tests | Low | Medium | Import `ExtensionAPI` from `@mariozechner/pi-coding-agent` peer dependency. If types are unavailable at test time (e.g., peer not installed), define a minimal local interface matching the `registerProvider` method signature used in `extensions/index.ts`. |
| `fetch` mock behavior differs from real `fetch` (e.g., `AbortSignal`) | Medium | Low | Use Vitest's `vi.fn()` to return real `Response` objects. For `AbortError`, have the mock throw a real `Error` with `name === "AbortError"`. |
| CI fails due to missing `package-lock.json` | Low | Low | Use `npm install` instead of `npm ci` if no lockfile exists, or generate a `package-lock.json` during the workflow. |
| Over-zealous regex heuristics cause test flakiness | Low | Medium | If new model names are added to fixtures that accidentally match/don't match heuristics, tests may need updating. Document the regex patterns clearly in test comments. |

## Validation Criteria

- [ ] `npm test` runs successfully and exits 0.
- [ ] All new test files (`test/model-mapping.test.ts`, `test/validators.test.ts`, `test/model-discovery.test.ts`, `test/config.test.ts`, `test/extension.test.ts`) contain at least one passing test.
- [ ] `hasVisionSupport` tests cover at least 10 model ID cases each (positive and negative).
- [ ] `hasReasoningSupport` tests cover at least 10 model ID cases each (positive and negative).
- [ ] `mapToPiModel` tests cover override precedence, heuristic defaults, and missing-metadata defaults.
- [ ] `discoverModels` integration tests cover all fallback paths: 404, 500, invalid shape, network error, abort signal.
- [ ] `resolveConfig` integration tests cover all edge cases: missing env, URL normalization, invalid URL, missing config file, valid config file, invalid JSON.
- [ ] Extension entry point test verifies `registerProvider` is called on success and NOT called on config/discovery failure.
- [ ] CI workflow passes on the branch before merge.
- [ ] Manual tests from `test/manual-test.md` still work after DI refactoring (spot-check at least the mock server scenario).
- [ ] `package.json` no longer contains no-op `echo` scripts.

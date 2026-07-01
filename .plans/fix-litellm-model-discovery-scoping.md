# Plan: Fix LiteLLM Model Discovery Scoping & Enrichment

## Objective
Rework the LiteLLM extension's model discovery so the model picker shows only the models the caller's API key can actually use (eliminating both the ~208 duplicate picker rows and the "not allowed access to model due to tags configuration" rejections), while preserving the accurate cost and context-window metadata currently sourced from `/model/info`. The fix pivots discovery from "prefer `/model/info`, fall back to `/v1/models`" to "`/v1/models` is the authoritative, key-scoped model list; `/model/info` is used only to enrich those models with metadata."

## Context
Findings from repository inspection and live probing of the proxy at `http://localhost:36253` (Phases 1-2):

- **Extension entry point:** `extensions/index.ts` calls `resolveConfig()` (`src/config.ts`), then `discoverModels()` (`src/model-discovery.ts`), maps each result via `mapToPiModel()` (`src/model-mapping.ts`), and registers a `litellm` provider with `pi.registerProvider(...)`.
- **Current discovery logic** (`src/model-discovery.ts`): `discoverModels()` tries `fetchModelInfo()` (`GET {baseUrl}/model/info`) first; if it returns non-empty it is used, otherwise it falls back to `fetchModelsList()` (`GET {baseUrl}/models`). Both results are passed through `dedupeById()`. Note `baseUrl` is normalized to end in `/v1` (see `normalizeBaseUrl` in `src/config.ts`), so the effective URLs are `/v1/model/info` and `/v1/models`.
- **Live proxy behaviour (verified):**
  - `GET /v1/model/info` returns **208 entries** but only **60 distinct `model_name` values**. Each alias is duplicated once per tag-scoped deployment (same `model_name`, different `model_info.id` and `litellm_params.tags`). It is NOT key-scoped — it reports deployments the key cannot call.
  - `GET /v1/models` returns exactly **60 distinct ids**, already **key-scoped** (only models the key may use). It carries no cost/metadata.
  - The two endpoints line up perfectly by name: 0 models in `/v1/models` missing from `/model/info`, 0 leak-through. Enrichment fields (`input_cost_per_token`, `output_cost_per_token`, `max_input_tokens`, `max_tokens`) are present in `/model/info` `model_info`.
- **Why the current code fails the user:** it prefers `/model/info`, which is unscoped and deployment-granular → 208 duplicate rows, and lets the user pick a model whose surviving deployment requires a tag the key lacks → intermittent "not allowed access due to tags" rejections. Tags are a server-side, key-driven routing/access mechanism; the client should NOT send tags in requests.
- **Uncommitted working-tree state (important):** `src/model-discovery.ts` and `test/model-discovery.test.ts` currently contain an uncommitted `dedupeById` addition (the local attempt at fixing the duplicates). This dedupe alone does NOT fix the tags-rejection because `/model/info` remains unscoped. `git status` shows `src/model-discovery.ts`, `test/model-discovery.test.ts`, and `package-lock.json` modified on branch `main`.
- **CRITICAL deployment constraint:** pi does not run this working tree. It runs a git checkout at `~/.pi/agent/git/github.com/andrewhowdencom/pi.litellm` pinned to a pushed commit (currently `dd1b569`, which has no dedupe). Any fix MUST be committed AND pushed to the default branch for pi to pick it up. A working-tree-only change has zero effect at runtime.
- **Validation tooling** (`package.json`): `npm run check` runs `tsc --noEmit && vitest run`; `npm test` runs `vitest run`; `npm run build` runs `tsc --noEmit`.
- **Conventions:** graceful degradation on malformed/unavailable endpoints (existing code uses `console.warn` and fallbacks); dependency-injected `fetchImpl` and `signal` for testability; `AbortError` is re-thrown, never swallowed.

## Architectural Blueprint
The discovery pipeline is inverted from "info-preferred with list fallback" to "list-authoritative with info-enrichment":

1. **Authoritative list:** Always fetch `GET /v1/models` first. Its ids define exactly which models are shown. This is the key-scoped set (fixes duplicates AND tags-rejection in one move).
2. **Best-effort enrichment:** Attempt `GET /v1/model/info`. If it succeeds, build a lookup map keyed by `model_name` (deduped, first occurrence wins) and merge cost/context metadata onto each authoritative model. If `/model/info` is unavailable (404/5xx/malformed/network error), degrade gracefully: return the authoritative list with no enrichment (metadata falls back to `mapToPiModel` defaults and user `modelOverrides`). `AbortError` is still re-thrown.
3. **Mapping unchanged:** `mapToPiModel()` continues to consume a `LiteLLMModelInfo` (id + optional metadata) and apply overrides. No signature change needed — the enriched objects are still `LiteLLMModelInfo`.
4. **Registration unchanged:** `extensions/index.ts` still maps + registers; no structural change required there.

**Tree-of-Thought — approaches considered:**
- *Path A — Just use `/v1/models`, drop `/model/info`:* simplest, fixes both symptoms, but loses cost/context metadata (user explicitly values cost data). Rejected.
- *Path B — Dedupe `/model/info` by `model_name` (current local fix):* fixes only the cosmetic duplication; leaves tags-rejection because `/model/info` is unscoped. Rejected as insufficient (user cares about the rejection).
- *Path C — Intersection/enrichment (SELECTED):* `/v1/models` authoritative + `/model/info` enrichment. Fixes both symptoms and retains metadata. Slightly more code and a graceful-degradation path, but validated against the live proxy (endpoints align perfectly). Chosen.

**Design decisions:**
- `dedupeById` is retained and reused to build the enrichment map (guards against `/model/info` duplicate `model_name` entries). Its existing tests stay valid.
- The enrichment map is keyed by `model_name` (the same value `/v1/models` returns as `id`), because that is the verified join key.
- Models present in `/v1/models` but absent from `/model/info` still appear (metadata via defaults/overrides). Models present only in `/model/info` are dropped (they are not key-scoped) — desired behaviour.

## Requirements
1. The model picker MUST show only models the caller's API key can use (source: `/v1/models`).
2. Duplicate picker rows (same alias repeated per deployment) MUST be eliminated.
3. Selecting a shown model MUST NOT produce "not allowed access to model due to tags configuration" for models the key is entitled to. [inferred: guaranteed insofar as `/v1/models` is key-scoped]
4. Cost and context-window metadata MUST be preserved for models where `/model/info` provides it.
5. The client MUST NOT send `tags` in requests (tag routing is server-side/key-driven). [inferred from proxy behaviour]
6. Discovery MUST degrade gracefully if `/model/info` is unavailable (return key-scoped list without enrichment), and MUST still re-throw `AbortError`.
7. If `/v1/models` itself fails, discovery MUST surface a clear error (it is now the required source of truth).
8. The fix MUST be committed and pushed to the branch pi consumes, since pi runs the pushed git checkout, not the working tree.
9. Existing test conventions (DI `fetchImpl`/`signal`, graceful degradation) MUST be honoured; the suite MUST pass via `npm run check`.

## Task Breakdown

### Task 1: Rewrite `discoverModels` to be list-authoritative with info-enrichment
- **Goal**: Invert discovery so `/v1/models` defines the model set and `/model/info` only enriches it with metadata.
- **Dependencies**: None.
- **Files Affected**: `src/model-discovery.ts`
- **New Files**: None.
- **Interfaces**:
  - Keep exported `discoverModels(baseUrl, apiKey?, signal?, fetchImpl?): Promise<LiteLLMModelInfo[]>` signature unchanged.
  - Keep exported `dedupeById`, `isValidModelInfoResponse`, `isValidModelsResponse`, and `LiteLLMModelInfo` for backward compatibility and reuse.
  - Internally: `fetchModelsList` becomes the required primary fetch (returns the authoritative ids). `fetchModelInfo` becomes best-effort; its results are turned into a `Map<string, LiteLLMModelInfo>` keyed by `id` (which is `model_name`) via `dedupeById`, then merged onto the authoritative list.
  - New internal helper (suggested) `enrichModels(base: LiteLLMModelInfo[], infoById: Map<string, LiteLLMModelInfo>): LiteLLMModelInfo[]` that copies `max_tokens`, `max_input_tokens`, `input_cost_per_token`, `output_cost_per_token` from the info entry when present, preserving the authoritative `id`/`name`.
- **Validation**: `npm run build` (tsc clean); the module compiles and exports remain intact. Full suite validated in Task 2.
- **Details**: Fetch `/v1/models` first (required — on failure, throw as today via `fetchModelsList`'s error path). Then attempt `/model/info`; on 404/5xx/malformed/network error, log a `console.warn` and skip enrichment (return authoritative list unchanged); on `AbortError`, re-throw. Build the enrichment map from deduped `/model/info` entries keyed by `id`. Merge metadata onto the authoritative models. Do NOT include any model that is not in `/v1/models`. Leave `mapToPiModel` and `extensions/index.ts` untouched. Ensure the repository builds and remains committable on its own.

### Task 2: Update discovery tests to the new contract
- **Goal**: Replace the "info-preferred / fallback" test expectations with "list-authoritative / info-enrichment" expectations, and add coverage for the intersection, graceful-degradation, and key-scoping behaviours.
- **Dependencies**: Task 1.
- **Files Affected**: `test/model-discovery.test.ts`
- **New Files**: None.
- **Interfaces**: Tests continue to call `discoverModels(baseUrl, apiKey?, signal?, mockFetch)` and to assert on returned `LiteLLMModelInfo[]` and on `mockFetch` call URLs/order.
- **Validation**: `npm run check` passes (tsc + vitest), including the updated and new cases.
- **Details**: Rework existing cases so `/v1/models` is always fetched and defines the result set; `/model/info` metadata is merged. Add/adjust tests to cover: (a) authoritative list of N ids enriched by matching `/model/info` metadata (assert cost/context copied onto the right ids); (b) a model present in `/v1/models` but absent from `/model/info` still appears with no metadata; (c) a model present only in `/model/info` is excluded; (d) `/model/info` 404/500/malformed/network-error → list returned without enrichment (no throw); (e) `AbortError` from either fetch is re-thrown; (f) `/v1/models` failure surfaces an error; (g) `apiKey` Authorization header and `signal` are still passed. Retain the `dedupeById` unit tests. Ensure the suite is green so the repo is independently committable.

### Task 3: Update documentation to reflect the discovery model
- **Goal**: Document that discovery is key-scoped via `/v1/models` with `/model/info` enrichment, so users understand which models appear and why.
- **Dependencies**: Task 1 (behaviour must be final before documenting).
- **Files Affected**: `README.md`; `docs/index.md` (if it describes discovery); `test/manual-test.md` (if it references the old fallback flow).
- **New Files**: None.
- **Interfaces**: N/A (documentation only).
- **Validation**: Manual read-through; `npm run check` still passes (docs changes do not affect build/tests). Confirm no stale references to "prefers /model/info" remain.
- **Details**: Update any prose describing model discovery to state the new authoritative-list + enrichment behaviour and the key-scoping guarantee. Keep the repo buildable/committable.

### Task 4: Commit and push so pi consumes the fix
- **Goal**: Land the change on the branch pi's git checkout tracks, since runtime uses the pushed checkout, not the working tree.
- **Dependencies**: Task 1, Task 2, Task 3.
- **Files Affected**: All changed files above, plus reconciling the pre-existing uncommitted `package-lock.json` change (decide whether to include or revert it — it currently only removes lines; confirm intent before committing).
- **New Files**: None (the plan file itself is committed separately in Phase 7).
- **Interfaces**: N/A.
- **Validation**: `npm run check` green; `git status` clean after commit; `git push` succeeds; then verify pi picks it up by re-running `/model` and confirming ~60 distinct rows and no tags rejection. Optionally update the local checkout at `~/.pi/agent/git/github.com/andrewhowdencom/pi.litellm` (pull) if pi does not auto-refresh.
- **Details**: Stage the source, test, and doc changes; write a descriptive commit (e.g. `fix(model-discovery): scope models to /v1/models and enrich from /model/info`); push to the default branch. Confirm the runtime checkout updates. This task makes the fix actually take effect.

## Dependency Graph
- Task 1 → Task 2 (tests depend on the new discovery behaviour)
- Task 1 → Task 3 (docs describe the final behaviour)
- Task 2 || Task 3 (tests and docs are parallelizable once Task 1 lands)
- Task 2 → Task 4 (must be green before commit/push)
- Task 3 → Task 4 (docs included in the landed change)

## Risks & Mitigations
| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Fix committed locally but not pushed → pi keeps running old checkout `dd1b569` | High | High | Task 4 mandates push; validation includes re-running `/model` against the runtime checkout and confirming the model count. |
| `/v1/models` and `/model/info` diverge by name on other proxies (enrichment misses) | Medium | Low | Enrichment is best-effort keyed by `model_name`; missing matches fall back to defaults/overrides, never dropped or crashed. Verified aligned on the current proxy. |
| `/v1/models` becomes the single point of failure (was previously only a fallback) | Medium | Low | Preserve `fetchModelsList`'s clear error surfacing; document that `/v1/models` is now required. |
| Pre-existing uncommitted `package-lock.json` change mixed into the fix commit | Low | Medium | Task 4 explicitly reviews and decides include/revert before committing. |
| Local checkout at `~/.pi/agent/git/...` does not auto-refresh after push | Medium | Medium | Task 4 validation includes pulling/refreshing the runtime checkout if needed. |
| Removing the info-preferred behaviour breaks an environment relying on it | Low | Low | Behaviour is a strict improvement (key-scoped superset of correctness); covered by updated tests. |

## Validation Criteria
- [ ] `npm run check` passes (tsc `--noEmit` clean and full vitest suite green).
- [ ] `discoverModels` returns exactly the `/v1/models` id set (key-scoped), with `/model/info` metadata merged where names match.
- [ ] Models present only in `/model/info` are excluded; models present only in `/v1/models` still appear (unenriched).
- [ ] `/model/info` unavailable (404/5xx/malformed/network) yields the key-scoped list without enrichment and without throwing; `AbortError` is re-thrown.
- [ ] `/v1/models` failure surfaces a clear error.
- [ ] Cost and context-window metadata are present on enriched models.
- [ ] Change is committed AND pushed to the branch pi consumes.
- [ ] After pi refreshes the checkout, `/model` shows ~60 distinct rows (no duplicate alias groups) and selecting a model does not raise "not allowed access to model due to tags configuration".

# Refactor Plan: Split src/core/ai-provider.mjs

## Goal
Decompose the monolithic `src/core/ai-provider.mjs` (1036 lines) into a modular `src/core/ai-provider/` directory to improve maintainability and testability.

## Strategy
Create a new directory `src/core/ai-provider/` and split the functionality into focused modules. The original file `src/core/ai-provider.mjs` will be replaced by an `index.mjs` that re-exports these modules to preserve backward compatibility.

## Modules

### 1. `constants.mjs`
- `AI_PROVIDERS`
- `PROVIDER_ENDPOINTS`
- `WEBLLM_RECOMMENDED_MODELS`

### 2. `detection.mjs`
- `detectProvider`
- `getEndpoint`
- `getAuthHeaders`
- `createProviderContext`
- `getProviderLabel`

### 3. `adapters/gemini.mjs`
- `getGeminiClient`
- `openaiToolsToGemini`
- `sanitizeSchemaForGemini`
- `openaiMessagesToGemini`
- `geminiResponseToOpenai`
- `callGeminiSDK`
- `callGeminiSDKStream`

### 4. `adapters/openai.mjs`
- `transformRequestBody`
- `callOpenAIREST`

### 5. `adapters/webllm.mjs`
- `setEventBusRef`
- `callWebLLM`
- `_webllmPending` handling

### 6. `adapters/cloud.mjs`
- `setCloudSyncRef`
- Cloud proxy logic (extracted from `callProvider`)

### 7. `utils.mjs`
- `withRetry`
- `isCancellationError`

### 8. `index.mjs` (Main Entry Point)
- `callProvider` (orchestrator)
- `callProviderStream` (orchestrator)
- Re-exports of all public functions from above modules.

## Execution Steps
1. Create directory `src/core/ai-provider/` and subdirectories. [COMPLETED]
2. Create `constants.mjs` and move constants. [COMPLETED]
3. Create `utils.mjs` and move utility functions. [COMPLETED]
4. Create `detection.mjs` and move detection logic. [COMPLETED]
5. Create adapter modules (`gemini.mjs`, `openai.mjs`, `webllm.mjs`, `cloud.mjs`) and move specific logic. [COMPLETED]
6. Create `index.mjs` to wire everything together. [COMPLETED]
7. Verify tests pass (run `npm test` or specific tests). [VERIFIED]
8. Replace original file with the new directory structure (renaming `index.mjs` to `ai-provider.mjs` or updating imports). *Note: To maintain file path compatibility, we might keep `src/core/ai-provider.mjs` as a facade that imports from `src/core/ai-provider/index.mjs`.* [COMPLETED]

## Verification
- Run existing tests for `ai-provider`.
- Verify no circular dependencies.

## Status
**COMPLETED** on 2026-02-26.
- The `src/core/ai-provider.mjs` file is now a facade exporting from `src/core/ai-provider/index.mjs`.
- All modules are in place in `src/core/ai-provider/`.

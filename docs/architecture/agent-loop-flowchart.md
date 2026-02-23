# Agent Loop Architecture: Simplified Actor-Critic Pipeline

## Overview

The assistant pipeline uses a **three-stage Actor-Critic architecture** that reduces complexity while maintaining quality through iterative refinement.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AssistantPipeline                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐     ┌──────────────────┐     ┌──────────┐        │
│   │ Prepare │ ──► │ Actor-Critic     │ ──► │ Finalize │        │
│   │         │     │ Loop             │     │          │        │
│   └─────────┘     └──────────────────┘     └──────────┘        │
│                           │                                     │
│                   ┌───────┴───────┐                            │
│                   │   Up to 3     │                            │
│                   │   iterations  │                            │
│                   └───────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Stage Details

### 1. Prepare Stage (`prepare.mjs`)
**Purpose**: Build context and validate the request

- Attach system prompt
- Inject current conversation messages  
- Add workspace context
- Set up tool availability
- Validate request structure

### 2. Actor-Critic Loop (`actor-critic-loop.mjs`)
**Purpose**: Iteratively generate and refine responses

```
┌─────────────────────────────────────────────────────────────┐
│                    Actor-Critic Loop                         │
│                                                              │
│   iteration = 0                                              │
│   while (iteration < MAX_ITERATIONS):                        │
│                                                              │
│       ┌──────────────┐                                       │
│       │    ACTOR     │  Generate response/execute tools      │
│       │              │  using AI provider                    │
│       └──────┬───────┘                                       │
│              │                                               │
│              ▼                                               │
│       ┌──────────────┐                                       │
│       │   CRITIC     │  Self-evaluate the response           │
│       │              │  Check quality metrics                │
│       └──────┬───────┘                                       │
│              │                                               │
│              ▼                                               │
│       ┌──────────────┐                                       │
│       │  Is quality  │                                       │
│       │  sufficient? │                                       │
│       └──────┬───────┘                                       │
│              │                                               │
│         YES ─┴─ NO                                           │
│          │      │                                            │
│          ▼      ▼                                            │
│       [EXIT]  [Continue with feedback]                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Quality Checks**:
- Response completeness
- Tool execution success
- Error detection
- User intent satisfaction

**Refinement Strategies**:
- Error correction
- Missing information retrieval
- Clarification requests
- Alternative approaches

### 3. Finalize Stage (`finalize.mjs`)
**Purpose**: Format and return the final response

- Extract final answer from context
- Clean up formatting
- Handle any remaining errors gracefully
- Set `ctx.finalResponse`

## Key Benefits

1. **Simplicity**: 3 stages vs. 8+ in previous architecture
2. **Self-Improvement**: Built-in quality feedback loop
3. **Bounded Iteration**: Maximum 3 cycles prevents infinite loops
4. **Unified Quality**: Critic stage replaces separate quality gate
5. **Clear Contracts**: Each stage has a single responsibility

## File Structure

```
src/core/stages/
├── index.mjs              # SimplifiedPipeline orchestrator
├── prepare.mjs            # Stage 1: Context preparation
├── actor-critic-loop.mjs  # Stage 2: Generation & refinement
└── finalize.mjs           # Stage 3: Response formatting
```

## Usage

```javascript
import { AssistantPipeline } from './assistant-pipeline.mjs';

const pipeline = new AssistantPipeline();
const response = await pipeline.execute(ctx, services);
```

## Migration Notes

The following components were consolidated or removed:

| Old Component | Status | Notes |
|---------------|--------|-------|
| validate.mjs | Merged | → prepare.mjs |
| inject-notifications.mjs | Merged | → prepare.mjs |
| preprocess.mjs | Merged | → prepare.mjs |
| triage.mjs | Removed | Handled by actor |
| agent-loop.mjs | Replaced | → actor-critic-loop.mjs |
| quality-gate-stage.mjs | Replaced | → critic in loop |
| postprocess.mjs | Merged | → finalize.mjs |
| quality-gate.mjs | Removed | Redundant |
| quality-evaluator.mjs | Removed | Integrated into critic |

## Error Handling

Errors are handled at each stage:

1. **Prepare**: Validation errors abort early with clear message
2. **Actor-Critic**: Errors trigger refinement attempt or graceful fallback
3. **Finalize**: Never throws; always returns some response

Abort signals are respected throughout the pipeline via `ctx.throwIfAborted()`.

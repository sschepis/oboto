# Message Display Consistency Fix — Architecture Plan

## Problem Statement

Tool calls that are part of an assistant response render inconsistently between live streaming and page reload:

1. **Live streaming (Bug 1):** Tool calls render as a standalone `background-tasks` message block, separate from the final text response bubble. The user sees two visually disconnected elements — a "Background Jobs" panel floating on its own, then a text response bubble below.

2. **Page reload (Bug 2):** Tool calls disappear entirely when the assistant message has text content. Only the text response is shown because `convertHistoryToUIMessages` puts tool calls in `toolCalls[]` but the content-less assistant messages get converted to `background-tasks` type without the text, and multi-step responses get fragmented.

**Desired behavior:** A single response bubble appears. Tool calls render **inside** that bubble as they execute (filling up progressively). Once complete, the text response appears below the tool calls, still within the same bubble. **This must look identical** whether streaming live or viewing after reload.

## Root Cause Analysis

### Data Flow (Live Streaming)

1. User sends message → server runs `assistant.run()`
2. During execution, tools fire events:
   - `server:tool-start` → broadcast `tool-start` → **useChat creates a new `background-tasks` message** (separate from any response)
   - `server:tool-end` → broadcast `tool-end` → useChat updates the task progress in that separate message
3. After all tools complete, `handleChat` sends a `message` event with `type: 'text'` containing the final response text
4. **Result:** Two separate messages — a `background-tasks` block and a `text` block

### Data Flow (Page Reload / History Load)

1. `convertHistoryToUIMessages()` iterates through history
2. For assistant messages **with content AND tool_calls**: Creates a single `type: 'text'` message with `toolCalls[]` populated — but the `MessageItem` renders these at the **bottom** of the text content
3. For assistant messages **without content but with tool_calls**: Converts to `type: 'background-tasks'` — renders as a standalone job panel
4. **Result:** Tool calls either appear at wrong position within bubble, or as separate panels

### Key Insight

The OpenAI conversation format stores the interaction as:
```
assistant: { content: null, tool_calls: [...] }   ← tool invocation
tool: { tool_call_id: X, content: "result" }       ← tool result  
assistant: { content: "Here is the image..." }     ← final response
```

These are **separate messages** in the LLM history. But in the UI, they should be **one visual unit** — a single response bubble containing tool calls followed by the text response.

## Solution Architecture

### Principle: A "response turn" = one visual bubble

Every assistant turn (which may span multiple LLM messages: tool-calling assistant messages + tool results + final assistant response) should be grouped into a **single UI message** with:
- `type: 'text'`
- `toolCalls: [...]` (grouped tool call blocks rendered inside the bubble, above the text)
- `content: "..."` (the final text response, rendered below tool calls)

### Changes Required

#### 1. Server: `convertHistoryToUIMessages()` in `src/server/ws-helpers.mjs`

**Current behavior:** Each assistant message becomes its own UI message. Content-less assistant messages with tool_calls become `background-tasks`.

**New behavior:** Group consecutive assistant+tool message sequences into a single UI message:

```
For each assistant message with tool_calls (and no content):
  → Collect its tool calls
  → Look ahead: skip the tool result messages
  → If the next assistant message has content (and no tool_calls),
    merge it all into ONE UI message:
    {
      type: 'text',
      toolCalls: [...collected tool calls with results],
      content: "final response text"
    }
  → If the next assistant message ALSO has tool_calls,
    keep accumulating (multi-round tool use)
```

This handles the multi-step pattern:
```
assistant(tool_calls) → tool(result) → assistant(tool_calls) → tool(result) → assistant(content)
```
All merged into one UI message.

#### 2. Client: `useChat.ts` — Live streaming tool events

**Current behavior:** `tool-start` creates/appends to a standalone `background-tasks` message. `tool-end` updates that message. Final `message` event creates a separate text message.

**New behavior:**

1. On `tool-start`:
   - Create or find a **pending response message** (type `'text'`, role `'ai'`) with a special marker (e.g., `_pending: true`)
   - Add the tool call to its `toolCalls[]` array with `status: 'running'`
   - This message renders as a response bubble with tool calls filling up inside

2. On `tool-end`:
   - Find the pending response message
   - Update the matching tool call's result and status to `'completed'`

3. On `message` (final text response):
   - Find the pending response message
   - Set its `content` to the response text
   - Remove the `_pending` flag
   - **Do NOT create a new message** — merge into the existing one

4. If no pending response exists when `message` arrives (edge case: no tools were called), create a normal text message as before.

#### 3. Client: `MessageItem.tsx` — Rendering

**Current behavior:** Tool calls render at the bottom of the text content, after a border separator, with a "Tool Calls" header.

**New behavior:** Tool calls render **above** the text content inside the bubble:

```tsx
{/* Render tool calls FIRST (above text) */}
{message.toolCalls && message.toolCalls.length > 0 && (
  <div className="space-y-2 mb-3">
    {message.toolCalls.map((tc, idx) => (
      <ToolCall key={idx} toolName={tc.toolName} args={tc.args} result={tc.result} />
    ))}
  </div>
)}

{/* Then render the text content */}
{message.content && <MarkdownRenderer content={message.content} />}
```

The `background-tasks` type can still exist for other use cases, but tool calls from a response turn should **never** use it. They always go into the response bubble.

#### 4. Types: `Message` interface in `ui/src/types/index.ts`

Add optional fields for live streaming state:

```ts
// In the toolCalls array items:
toolCalls?: Array<{
    toolName: string;
    args: unknown;
    result?: unknown;
    status?: 'running' | 'completed';  // NEW: for live progress indication
}>;

// On the message itself:
_pending?: boolean;  // NEW: marks a response still being built
```

### Visual Result

Both live and reload will show:

```
┌─────────────────────────────────┐
│ NEXUS                           │
│ ┌─────────────────────────────┐ │
│ │ 🔧 generate_image           │ │  ← Tool call (collapsible)
│ │   Input: {...}              │ │
│ │   Output: {...}             │ │
│ └─────────────────────────────┘ │
│                                 │
│ Here is the generated image of  │  ← Text response
│ a cat:                          │
│ 🖼️ [image]                      │
│ A cute photorealistic cat       │
└─────────────────────────────────┘
```

### Edge Cases

1. **Multiple tool calls in sequence:** All accumulate in the same bubble
2. **No text response (tool-only turn):** Bubble shows just tool calls, no text below
3. **No tool calls (text-only response):** Bubble shows just text, as before
4. **Streaming text (if implemented later):** Text can progressively appear below tool calls
5. **Error/cancellation mid-tool:** Pending message stays with whatever was collected; error message appended as content

### Files to Modify

| File | Change |
|------|--------|
| `src/server/ws-helpers.mjs` | Rewrite `convertHistoryToUIMessages` to group response turns |
| `ui/src/hooks/useChat.ts` | Rewrite `tool-start`, `tool-end`, `message` handlers to build unified response messages |
| `ui/src/components/chat/MessageItem.tsx` | Move tool calls above text content in the response bubble |
| `ui/src/types/index.ts` | Add `status` to toolCalls items, add `_pending` to Message |

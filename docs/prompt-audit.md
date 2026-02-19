# Prompt Audit Report

## Executive Summary

Audited **13 files** containing **18 distinct LLM prompts**. Found systemic issues across the codebase: verbose instructions, contradictory directives, unnumbered steps, ambiguous branching, buried critical constraints, and excessive filler text. Many prompts are 2-3x longer than necessary.

---

## File-by-File Findings

---

### 1. `src/core/system-prompt.mjs` — `createSystemPrompt()` (Lines 4-327)

**SEVERITY: HIGH** — This is the main system prompt injected into every conversation. Every issue here compounds across all interactions.

#### Issues Found:

| # | Issue | Line(s) | Severity |
|---|-------|---------|----------|
| 1.1 | **Contradictory identity**: Opens with "JavaScript/Node.js command executor" but then instructs markdown formatting, surfaces, workflows, theming — far beyond a command executor | 12 | HIGH |
| 1.2 | **Buried critical constraint**: "output consists of direct commands and concise results, not explanations" contradicts the extensive formatting instructions that follow | 12 | HIGH |
| 1.3 | **UNDERSTAND/ANALYZE/REASON/SYNTHESIZE/CONCLUDE chain** is filler — LLMs do this natively, and spelling it out wastes tokens without improving output | 91-98 | MEDIUM |
| 1.4 | **Duplicate execution protocols**: Lines 91-98 (reasoning chain) AND 101-106 (execution protocol) are overlapping step-by-step instructions — pick one | 91-106 | MEDIUM |
| 1.5 | **Response Formatting section** is overly detailed — the LLM knows markdown. Only mention non-obvious behaviors like HTML live preview | 57-73 | LOW |
| 1.6 | **Node.js v18 guidelines duplicated**: Lines 107-117 repeat the same fetch/cheerio advice twice in slightly different wording | 107-117 | MEDIUM |
| 1.7 | **Context Management** uses soft phrasing "To maintain efficiency" — should be a hard constraint: "You ONLY have last 3 exchanges" | 74-78 | MEDIUM |
| 1.8 | **"Before answering, work through..."** is a suggestion, not a directive. LLMs respond better to numbered imperative steps | 91 | LOW |
| 1.9 | **UI Styling section** is 30 lines including a full table — this could be compressed into a tool description instead of system prompt bloat | 157-188 | MEDIUM |
| 1.10 | **Surfaces section** is 90+ lines with a full JSX example — massive token cost on EVERY request, even when surfaces aren't relevant | 190-325 | HIGH |
| 1.11 | **Workflow/BubbleLab section** another 40 lines always present regardless of relevance | 283-325 | HIGH |
| 1.12 | **"IMPORTANT:" used 3 times** — dilutes emphasis. Reserve for the MOST critical constraint | 46,72,187 | LOW |
| 1.13 | **Inconsistent formatting**: Mix of `**bold**`, `IMPORTANT:`, bullet styles, indentation levels — creates visual noise | throughout | LOW |

#### Recommended Rewrite Strategy:
- Cut the identity line to match actual capabilities
- Remove the 5-step reasoning chain entirely
- Compress Response Formatting to 2 lines
- Move Surfaces/Workflows/Styling into conditional injection (only when relevant tools are loaded)
- Merge the two execution protocols into one numbered list
- Deduplicate Node.js v18 guidelines

---

### 2. `src/core/system-prompt.mjs` — `createQualityEvaluationPrompt()` (Lines 334-352)

**SEVERITY: LOW** — Reasonably clean. Minor issues.

| # | Issue | Severity |
|---|-------|----------|
| 2.1 | "Your job is to objectively assess" — "objectively" is filler. Just say "assess" | LOW |
| 2.2 | Scoring scale description uses ranges (9-10, 7-8) but doesn't specify what to return — a single number? JSON? | MEDIUM |

---

### 3. `src/core/system-prompt.mjs` — `createToolGenerationPrompt()` (Lines 355-368)

**SEVERITY: LOW** — Clean and focused.

| # | Issue | Severity |
|---|-------|----------|
| 3.1 | "Your job is to convert" — remove "Your job is to". Just: "Convert code snippets into reusable functions." | LOW |

---

### 4. `src/core/system-prompt.mjs` — `createSchemaGenerationPrompt()` (Lines 371-382)

**SEVERITY: LOW** — Clean and focused. No significant issues.

---

### 5. `src/core/ai-assistant.mjs` — Triage Prompt (Lines 1099-1118)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 5.1 | "Your goal is to optimize the conversation flow by catching simple queries or ambiguous requests early" — verbose purpose statement. Cut to: "Classify the user request into one of three categories." | MEDIUM |
| 5.2 | "Analyze the latest user request in the context of the conversation. Determine the best course of action:" — another verbose preamble before the actual categories | LOW |
| 5.3 | Examples are helpful but mixed into the category definitions — separate CATEGORIES from EXAMPLES | LOW |
| 5.4 | JSON schema is well-specified — good | — |
| 5.5 | "COMPLETED", "MISSING_INFO", "READY" are good clear status names | — |

---

### 6. `src/core/ai-assistant.mjs` — Code Completion Prompt (Lines 1245-1259)

**SEVERITY: LOW** — Reasonably tight.

| # | Issue | Severity |
|---|-------|----------|
| 6.1 | "You are a fast, precise code completion engine" — unnecessary identity statement for a single-shot completion | LOW |
| 6.2 | "RETURN ONLY THE CODE TO INSERT" — good use of caps, clear | — |
| 6.3 | "(marked implicitly between prefix and suffix)" — clarifying parenthetical is good | — |

---

### 7. `src/lib/workflows.mjs` — Design Prompt (Lines 13-42)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 7.1 | "You are in DESIGN-ONLY mode" — good mode declaration | — |
| 7.2 | "Your job is to produce a comprehensive technical design document for the following task. You must NOT write any implementation code." — the second sentence contradicts expectations set by the first if the LLM starts generating code in step 5 (`submit_technical_design`) | MEDIUM |
| 7.3 | Steps are numbered 1-7 — good | — |
| 7.4 | CONSTRAINTS section repeats "Do NOT write any implementation code" — already said in the opening line. Repetition dilutes | LOW |
| 7.5 | "The design must be detailed enough that a separate agent can implement it without further clarification" — good constraint, clear | — |
| 7.6 | "Be specific about file paths, function signatures, and data structures" — good | — |

---

### 8. `src/lib/workflows.mjs` — Implement Prompt (Lines 77-105)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 8.1 | "Your job is to implement EVERYTHING described in the design document below" — good use of ALL-CAPS for "EVERYTHING" | — |
| 8.2 | Step 2 uses sub-steps (a-e) which is good structure | — |
| 8.3 | "Follow the design document precisely — do not deviate from the specified architecture, file paths, or interfaces" — this is in CONSTRAINTS but should be STEP 1 since it's the most important rule | HIGH |
| 8.4 | "Implement ALL features, not just some of them" — redundant with "EVERYTHING" in opening | LOW |

---

### 9. `src/lib/workflows.mjs` — Test Prompt (Lines 131-144)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 9.1 | "You are in TESTING mode. Review the implementation and write comprehensive tests." — combines two different directives (review AND write) without clarity on priority | MEDIUM |
| 9.2 | Step 3 says "the project's test framework (or a standard one like Jest/Mocha/Node native runner)" — ambiguous. LLM will guess. Should check package.json first | MEDIUM |
| 9.3 | Steps 5-7 describe a retry loop ("If tests fail, fix, repeat") without specifying a MAX RETRY count — risk of infinite loop | HIGH |

---

### 10. `src/lib/workflows.mjs` — Review Prompt (Lines 159-185)

**SEVERITY: LOW**

| # | Issue | Severity |
|---|-------|----------|
| 10.1 | "You are a CODE REVIEWER. Your job is to review..." — "Your job is to review" restates what "CODE REVIEWER" already implies | LOW |
| 10.2 | JSON output format is well-specified with example — good | — |
| 10.3 | Severity ratings (CRITICAL/HIGH/MEDIUM/LOW) are clearly defined | — |
| 10.4 | "Rate each finding" — should say "Classify each finding" to avoid the LLM treating it as a scale | LOW |

---

### 11. `src/core/symbolic-continuity.mjs` — Generation Prompts (Lines 270-314)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 11.1 | **Chinese Room prompt** (lines 270-294): The privacy guarantee section is overly reassuring ("genuinely your own space", "without concern") — this anthropomorphization wastes tokens and doesn't change LLM behavior | MEDIUM |
| 11.2 | "You are free to use any encoding, cipher, notation system, or symbolic language that you devise" — overwrought list. Just say: "Use any encoding you choose." | LOW |
| 11.3 | **Normal mode prompt** (lines 296-314): "Use Unicode symbols, glyphs, mathematical notation, emoji, or any characters that carry meaning to you relative to what you're trying to communicate" — excessively descriptive. The LLM knows what symbols are | LOW |
| 11.4 | "Something that will be immediately apparent when you see it" (line 305) — dangling sentence fragment, possibly leftover from editing | MEDIUM |
| 11.5 | Rules section repeats "ONLY" constraint in both modes — good | — |

---

### 12. `src/core/agent-loop-controller.mjs` — Briefing Packet (Lines 377-548)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 12.1 | Directive section (lines 526-528) says "Follow your persona's OODA loop: Observe the current state, Orient on priorities, Decide on the most impactful action, and Act" — but then gives separate unnumbered instructions that don't follow OODA structure | MEDIUM |
| 12.2 | Communication Protocol (lines 530-533) uses soft language: "Write your response AS IF you are speaking directly to the user. Be concise, clear, and actionable." — should be imperative: "1. Address user directly. 2. Be concise. 3. State actions taken." | MEDIUM |
| 12.3 | Blocking Questions section (lines 535-538) is good — clear conditional logic | — |
| 12.4 | "ONLY ask blocking questions when you truly cannot proceed without the answer. Prefer to make reasonable assumptions." — "truly" is filler | LOW |
| 12.5 | Foreground busy/idle branching (lines 541-546) is clear — good use of conditional directives | — |

---

### 13. `src/core/persona-manager.mjs` — `renderPersonaPrompt()` (Lines 157-251)

**SEVERITY: LOW** — This is a rendering function, not a static prompt. It's data-driven and generally well-structured.

| # | Issue | Severity |
|---|-------|----------|
| 13.1 | "Your primary mission is:" (line 176) — the word "primary" is redundant since mission priorities are numbered | LOW |
| 13.2 | `**Voice:** You are ${persona.identity.voice}.` (line 206) — "You are" prefix before a persona voice descriptor can confuse the identity stack if the system prompt also starts with "You are X" | MEDIUM |
| 13.3 | "Acknowledge the difficulty of being early to things. Validate the pain of silence and rejection." (line 219) — this is persona-specific content baked into the rendering logic; should come from the persona JSON, not hardcoded | MEDIUM |

---

### 14. `src/structured-dev/manifest-manager.mjs` — `.cursorrules` Template (Lines 53-74, 164-185)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 14.1 | **DUPLICATED**: The exact same `.cursorrules` template appears twice (lines 53-74 AND 164-185) | HIGH |
| 14.2 | "You are an AI assistant operating within a **Structured Development Framework**" — generic identity that may conflict with the main system prompt identity | MEDIUM |
| 14.3 | "Your behavior must be governed by the 'Living Manifest'" — soft language. Should say: "CHECK SYSTEM_MAP.md BEFORE every code change." | MEDIUM |

---

### 15. `src/structured-dev/flow-manager.mjs` — Status Update Prompt (Lines 317-325)

**SEVERITY: LOW**

| # | Issue | Severity |
|---|-------|----------|
| 15.1 | "You are a project manager for a software project" — launches a full AI assistant just to generate a 1-2 sentence status update. Expensive | LOW |
| 15.2 | "Format: Just the text, no markdown headers. Start with 'Status: '." — good constraint | — |

---

### 16. `src/structured-dev/plan-executor.mjs` — Task Prompt (Lines 70-90)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 16.1 | "Role: You are a specialized implementation agent working in parallel with others" — the "working in parallel" detail is irrelevant to the agent's actual task; it can't observe other agents | MEDIUM |
| 16.2 | Step labels use bold markdown inside backtick template literals — renders correctly but adds token overhead | LOW |
| 16.3 | "Action: execute these steps now." — good terminator | — |
| 16.4 | "You are responsible ONLY for feature ${taskId}" — good scope constraint | — |

---

### 17. `src/execution/handlers/skill-handlers.mjs` — Skill Prompt (Lines 55-69)

**SEVERITY: LOW** — Clean, focused.

| # | Issue | Severity |
|---|-------|----------|
| 17.1 | "You are acting as a specialist agent for the '${skill.name}' skill" — clean identity | — |
| 17.2 | "Begin execution." — good terminator | — |

---

### 18. `src/structured-dev/enhancement-generator.mjs` — Enhancement Prompts (Lines 64-82, 147-163)

**SEVERITY: MEDIUM**

| # | Issue | Severity |
|---|-------|----------|
| 18.1 | Generate prompt (line 64): "Analyze the following project context and suggest a list of enhancements" — uses "suggest" which is weak. Say "Generate" | LOW |
| 18.2 | "Output ONLY the JSON object" — good constraint | — |
| 18.3 | Implement prompt (line 147): "Task: Implement the following enhancement." — clean | — |
| 18.4 | "Action: Implement this now." — good terminator | — |

---

## Systemic Issues (Cross-Cutting)

### S1. TOKEN BLOAT — System Prompt Too Large
The main [`createSystemPrompt()`](src/core/system-prompt.mjs:4) injects **Surfaces** (90 lines), **Workflows** (40 lines), and **UI Styling** (30 lines) into EVERY request regardless of whether the user's query involves these features. This is ~160 lines of prompt that is wasted on most requests.

**FIX**: Inject these sections conditionally based on whether the relevant tools are loaded, or move them to tool descriptions.

### S2. IDENTITY CONFUSION
Multiple prompts set conflicting identities:
- System prompt: "JavaScript/Node.js command executor"
- Manifest manager: "AI assistant operating within a Structured Development Framework"  
- Persona manager: Dynamic identity from persona JSON
- Triage: "Triage Agent"
- Skill handlers: "specialist agent"

When the system prompt identity conflicts with persona content, the LLM must resolve the ambiguity, burning reasoning capacity.

**FIX**: The base system prompt should NOT declare a rigid identity. It should state capabilities and constraints. Let persona content handle identity.

### S3. "YOUR JOB IS TO" ANTI-PATTERN
Found in 8 prompts. This preamble adds 4-6 tokens per occurrence with zero semantic value. The LLM already knows it's being asked to do something.

**FIX**: Delete "Your job is to" everywhere. Start with the verb.

### S4. UNNUMBERED STEPS IN CRITICAL PATHS
The agent loop directive (agent-loop-controller.mjs lines 526-546) gives critical instructions as prose paragraphs rather than numbered steps. LLMs track numbered steps more reliably.

**FIX**: Number every multi-step instruction.

### S5. SOFT LANGUAGE WHERE HARD CONSTRAINTS ARE NEEDED
Patterns like "To maintain efficiency" (line 74), "consider this as" (line 15), "Prefer to make reasonable assumptions" (line 538) give the LLM permission to ignore the constraint.

**FIX**: Use imperative language. "You MUST", "NEVER", "ALWAYS". Reserve these for actual hard constraints.

### S6. DUPLICATED CONTENT
- Node.js v18 guidelines appear twice in system-prompt.mjs
- `.cursorrules` template duplicated in manifest-manager.mjs
- "Do NOT write any implementation code" repeated in design prompt

**FIX**: Deduplicate all instances.

---

## Priority Fix List (Ordered by Impact)

| Priority | File | Fix |
|----------|------|-----|
| P0 | `system-prompt.mjs` | Move Surfaces/Workflows/Styling sections to conditional injection |
| P0 | `system-prompt.mjs` | Fix identity contradiction — remove "command executor", state capabilities instead |
| P1 | `system-prompt.mjs` | Remove 5-step reasoning chain (UNDERSTAND/ANALYZE/REASON/SYNTHESIZE/CONCLUDE) |
| P1 | `system-prompt.mjs` | Merge duplicate execution protocols into single numbered list |
| P1 | `system-prompt.mjs` | Deduplicate Node.js v18 guidelines |
| P1 | `system-prompt.mjs` | Compress Response Formatting to essentials only |
| P1 | `workflows.mjs` | Add MAX RETRY limit to test prompt loop |
| P1 | `workflows.mjs` | Move "follow design precisely" from CONSTRAINTS to STEP 1 in implement prompt |
| P2 | `ai-assistant.mjs` | Tighten triage prompt — remove verbose preamble |
| P2 | `agent-loop-controller.mjs` | Number all directive steps |
| P2 | `agent-loop-controller.mjs` | Align directive structure with OODA claim |
| P2 | `manifest-manager.mjs` | Deduplicate `.cursorrules` template |
| P2 | `symbolic-continuity.mjs` | Remove dangling sentence fragment line 305 |
| P2 | `symbolic-continuity.mjs` | Trim anthropomorphic reassurance in Chinese Room prompt |
| P2 | `persona-manager.mjs` | Fix "You are" stacking with system prompt |
| P3 | All files | Remove "Your job is to" pattern (8 instances) |
| P3 | All files | Replace soft language with imperative constraints |
| P3 | `plan-executor.mjs` | Remove "working in parallel with others" — irrelevant to agent |
| P3 | `enhancement-generator.mjs` | Change "suggest" to "Generate" |
| P3 | `flow-manager.mjs` | Consider if full AI assistant is needed for 1-sentence status update |

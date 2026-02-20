// Stage 4: triage
// Runs a lightweight triage check on the user's request.
// Can fast-path simple queries (COMPLETED), ask for clarification (MISSING_INFO),
// or proceed to the full agent loop (READY).

import { consoleStyler } from '../../ui/console-styler.mjs';
import { TASK_ROLES } from '../prompt-router.mjs';

/**
 * @param {import('../request-context.mjs').RequestContext} ctx
 * @param {import('../service-registry.mjs').ServiceRegistry} services
 * @param {Function} next
 */
export async function triage(ctx, services, next) {
    // Skip triage on retries — we already know we need the full agent loop
    if (ctx.isRetry) {
        await next();
        return;
    }

    const promptRouter = services.get('promptRouter');
    const llmAdapter = services.get('llmAdapter');
    const historyManager = services.get('historyManager');
    const transcriptLogger = services.optional('transcriptLogger');

    try {
        const modelConfig = promptRouter.resolveModel(TASK_ROLES.TRIAGE);
        const fullHistory = historyManager.getHistory();
        // Strip tool-related messages (assistant+tool_calls, tool responses) to
        // avoid Gemini's strict functionCall→functionResponse ordering constraint.
        // Triage only needs conversational context, not tool execution history.
        const conversationalHistory = fullHistory.filter(m =>
            m.role !== 'tool' && !(m.role === 'assistant' && m.tool_calls)
        );
        const recentHistory = conversationalHistory.slice(-5);

        const systemPrompt = `Classify the user request into exactly one category.

**COMPLETED** — Simple query you can answer immediately without tools or files.
Examples: greetings, general knowledge, short code snippets.
IMPORTANT: Do NOT classify as COMPLETED if the user is asking about or requesting
a capability that requires tools. The assistant HAS tools for: text-to-speech
(speak_text), browser automation, file operations, web search, image generation,
desktop automation, code execution, and many more. If the user asks about any of
these capabilities (e.g., "can you speak aloud?", "can you browse the web?"),
classify as READY so the agent loop can use the appropriate tool.

**MISSING_INFO** — Too vague to act on. Critical details missing.
Examples: "Fix the bug" (which?), "Update the file" (which?).

**READY** — Requires tools, file access, project context, or deep reasoning.
Examples: "Refactor ai-assistant.mjs", "Check the logs", "Speak this aloud",
"Can you read this to me?", "Browse to example.com".

Return JSON:
{
  "status": "COMPLETED" | "MISSING_INFO" | "READY",
  "reasoning": "one sentence",
  "response": "answer if COMPLETED, else null",
  "missing_info_question": "clarifying question if MISSING_INFO, else null"
}`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...recentHistory.filter(m => m.role !== 'system'),
        ];

        if (transcriptLogger) {
            transcriptLogger.log('TRIAGE_REQUEST', modelConfig.modelId, messages);
        }

        const result = await llmAdapter.generateContent({
            model: modelConfig.modelId,
            messages,
            temperature: 0.1,
            response_format: { type: 'json_object' },
        });

        if (transcriptLogger) {
            transcriptLogger.log('TRIAGE_RESPONSE', modelConfig.modelId, result);
        }

        const content = result.choices[0].message.content;
        const cleanContent = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        const triageResult = JSON.parse(cleanContent);
        ctx.triageResult = triageResult;

        if (triageResult.status === 'COMPLETED' && triageResult.response) {
            consoleStyler.log('routing', 'Triage: Request completed immediately (Fast Path).');
            ctx.finalResponse = triageResult.response;
            ctx._skipToFinalize = true;
            await next();
            return;
        }

        if (triageResult.status === 'MISSING_INFO' && triageResult.missing_info_question) {
            consoleStyler.log('routing', 'Triage: Request ambiguous, asking for clarification.');
            ctx.finalResponse = triageResult.missing_info_question;
            ctx._skipToFinalize = true;
            await next();
            return;
        }

        consoleStyler.log('routing', 'Triage: Request validated, proceeding to main agent.');
    } catch (error) {
        consoleStyler.log('warning', `Triage check failed, falling back to main loop: ${error.message}`);
        // Non-fatal: proceed to agent loop
    }

    await next();
}

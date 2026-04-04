/**
 * ObotoProvider — AgenticProvider that wraps oboto-agent's dual-LLM
 * orchestration core.
 *
 * Bridges ai-man's deps (aiProvider, toolExecutor, historyManager) into
 * oboto-agent's interface (llm-wrapper BaseProvider, swiss-army-tool Router,
 * as-agent Session) and maps oboto-agent events to StreamController
 * for real-time UI updates matching the unified/as-agent provider flow.
 *
 * @module src/core/agentic/oboto/oboto-provider
 */

import { AgenticProvider } from '../base-provider.mjs';
import { StreamController } from '../unified/stream-controller.mjs';
import { ObotoAgent, fromChat, createEmptySession } from '@sschepis/oboto-agent';
import { buildOmniToolTree } from '../../../tools/omni-tool-tree.mjs';
import { createLLMProviderPair } from './lmscript-adapter.mjs';
import { config } from '../../../config.mjs';

export class ObotoProvider extends AgenticProvider {
    constructor() {
        super();
        this._router = null;
        this._omniRoot = null;
        this._localProvider = null;
        this._remoteProvider = null;
        this._localModelName = null;
        this._remoteModelName = null;
    }

    get id() { return 'oboto'; }
    get name() { return 'Oboto Agent'; }
    get description() {
        return 'Dual-LLM agent core with local triage and event-driven tool execution via oboto-agent';
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    async initialize(deps) {
        await super.initialize(deps);

        // Build swiss-army-tool Router from ai-man's tool executor
        const omni = buildOmniToolTree(deps.toolExecutor, {
            supportLlm: deps.supportLlm,
        });
        this._router = omni.router;
        this._omniRoot = omni.root;

        // Create llm-wrapper-compatible LLM providers
        const pair = createLLMProviderPair(deps);
        this._localProvider = pair.localProvider;
        this._remoteProvider = pair.remoteProvider;
        this._localModelName = pair.localModelName;
        this._remoteModelName = pair.remoteModelName;
    }

    async dispose() {
        this._router = null;
        this._omniRoot = null;
        this._localProvider = null;
        this._remoteProvider = null;
        await super.dispose();
    }

    // ── Main Execution ───────────────────────────────────────────────

    async run(input, options = {}) {
        return this._deduplicatedRun(input, options, async () => {
            return this._execute(input, options);
        });
    }

    async _execute(input, options) {
        const stream = new StreamController({
            onToken: options.onToken,
            onChunk: options.onChunk,
            signal: options.signal,
        });

        try {
            // ── Phase: Request ──
            stream.phaseStart('request', `Processing: ${input.substring(0, 80)}…`);

            // Convert ai-man history → as-agent Session
            const history = options.conversationHistory
                || this._deps.historyManager?.getHistory()
                || [];
            const session = this._convertHistory(history);

            const modelName = options.model || this._remoteModelName;
            const systemPrompt = this._buildSystemPrompt();

            // ── Phase: Planning ──
            stream.phaseStart('planning', 'Building context and preparing tools…');

            // Determine if we should stream tokens
            const isStreaming = !!(options.onToken || options.onChunk);

            // Create per-turn ObotoAgent with streaming callback
            const agent = new ObotoAgent({
                localModel: this._localProvider,
                remoteModel: this._remoteProvider,
                localModelName: this._localModelName,
                remoteModelName: modelName,
                router: this._router,
                session,
                maxIterations: options.maxIterations || config?.ai?.agentic?.maxIterations || 25,
                maxContextTokens: config?.ai?.agentic?.maxContextTokens || 8192,
                systemPrompt,
                // Wire real-time token streaming
                onToken: isStreaming ? (token) => stream.token(token) : undefined,
            });

            // Wire oboto-agent events → StreamController
            this._wireEvents(agent, stream, isStreaming);

            // Wire abort signal → interrupt
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    agent.interrupt();
                }, { once: true });
            }

            // ── Phase: Thinking ──
            stream.phaseStart('thinking', 'Sending request to AI model…');

            // Execute
            await agent.submitInput(input);

            // Extract response
            const agentSession = agent.getSession();
            const response = this._extractLastResponse(agentSession);

            agent.removeAllListeners();

            return {
                response,
                streamed: isStreaming,
                tokenUsage: {},
                metadata: {
                    provider: 'oboto',
                    model: modelName,
                },
            };
        } finally {
            stream.dispose();
        }
    }

    // ── Event Bridge ─────────────────────────────────────────────────

    _wireEvents(agent, stream, isStreaming) {
        agent.on('triage_result', (e) => {
            const { escalate, reasoning } = e.payload;
            if (escalate) {
                stream.phaseStart('precheck', `Escalating: ${reasoning}`);
            } else {
                stream.phaseStart('precheck', `Direct: ${reasoning}`);
            }
        });

        agent.on('agent_thought', (e) => {
            const { text, model, escalating, iteration } = e.payload;
            if (escalating) {
                stream.phaseStart('thinking', text);
            } else if (text) {
                // Non-streaming: emit text as commentary
                // Streaming: tokens already emitted via onToken, just show status
                if (!isStreaming) {
                    stream.commentary('🤖', text.substring(0, 200));
                } else {
                    // Brief status showing iteration progress
                    if (iteration) {
                        stream.status(`AI thinking — iteration ${iteration}…`);
                    }
                }
            }
        });

        agent.on('tool_execution_start', (e) => {
            const { command, kwargs } = e.payload;
            stream.phaseStart('tools', `Running tool: ${command}`);
            stream.toolStart(command, kwargs, 0, 1);
        });

        agent.on('tool_execution_complete', (e) => {
            const { command, result, error } = e.payload;
            const success = !error && result !== '[duplicate call blocked]';
            stream.toolComplete(command, success);
            if (!success && result === '[duplicate call blocked]') {
                stream.commentary('⚠️', `Duplicate call to "${command}" blocked`);
            }
        });

        agent.on('tool_round_complete', (e) => {
            const { iteration, tools, totalToolCalls } = e.payload;
            const summary = tools.map(t =>
                `${t.success ? '✓' : '✗'} ${t.command}`
            ).join(', ');
            stream.commentary('🔧', `Round ${iteration}: ${summary} (${totalToolCalls} total calls)`);
            stream.phaseStart('thinking', 'AI analyzing results…');
        });

        agent.on('error', (e) => {
            stream.phaseStart('error', e.payload.message || 'Unknown error');
        });

        agent.on('interruption', () => {
            stream.phaseStart('cancel', 'Interrupted by user');
        });

        agent.on('turn_complete', () => {
            stream.phaseStart('complete', 'Response ready');
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────

    _convertHistory(history) {
        if (!history || history.length === 0) {
            return createEmptySession();
        }

        const messages = history
            .filter(msg => msg && msg.role)
            .map(msg => {
                let content = msg.content;
                if (content == null) content = '';
                if (typeof content !== 'string' && !Array.isArray(content)) {
                    content = String(content);
                }

                if (msg.role === 'tool') {
                    return fromChat({
                        role: 'user',
                        content: `[Tool result (${msg.name || 'unknown'}): ${typeof content === 'string' ? content.substring(0, 2000) : '...'}]`,
                    });
                }

                if (msg.role === 'assistant' && msg.tool_calls?.length > 0) {
                    const callText = msg.tool_calls
                        .map(tc => `[Tool call: ${tc.function?.name}(${tc.function?.arguments?.substring(0, 200) || ''})]`)
                        .join('\n');
                    const textContent = typeof content === 'string' ? content : '';
                    return fromChat({
                        role: 'assistant',
                        content: textContent ? `${textContent}\n${callText}` : callText,
                    });
                }

                return fromChat({
                    role: msg.role === 'tool' ? 'user' : msg.role,
                    content: typeof content === 'string' ? content : '',
                });
            });

        return { version: 1, messages };
    }

    _extractLastResponse(session) {
        if (!session?.messages?.length) return '';

        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            // MessageRole.Assistant = 2
            if (msg.role === 2) {
                return msg.blocks
                    .filter(b => b.kind === 'text')
                    .map(b => b.text)
                    .join('\n');
            }
        }
        return '';
    }

    _buildSystemPrompt() {
        const persona = this._deps.facade?.engine?.context?.persona;
        if (persona?.systemPrompt) return persona.systemPrompt;

        const configPrompt = config?.ai?.systemPrompt;
        if (configPrompt) return configPrompt;

        return 'You are a helpful AI assistant with access to tools for file operations, shell commands, and more. Use tools when needed to accomplish tasks.';
    }
}

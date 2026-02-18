import { AiManEventBus } from '../lib/event-bus.mjs';
import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Manages the autonomous agent loop — play/pause/stop controls
 * for a recurring background AI invocation.
 *
 * Each tick assembles a "briefing packet" from the foreground assistant's
 * conversation history, holographic memory, active schedules, and recent
 * task results, then spawns a background task with that context.
 *
 * Uses its own setInterval timer (NOT SchedulerService) because:
 * - Agent loop state is intentionally NOT persisted across restarts
 * - We need to inject a dynamically-built briefing packet into each task
 * - SchedulerService would spawn tasks with a static query string
 *
 * Communication Protocol:
 * - Background agent results are injected into the main chat conversation
 * - Background agent can ask BLOCKING questions that pause the loop
 * - Questions are resolved when the user responds via the UI
 */
export class AgentLoopController {
    /**
     * @param {object} deps
     * @param {import('./scheduler-service.mjs').SchedulerService} deps.schedulerService — for reading active schedules (context only)
     * @param {import('./task-manager.mjs').TaskManager} deps.taskManager
     * @param {import('./ai-assistant.mjs').MiniAIAssistant} deps.assistant  — the *foreground* assistant (read-only for context)
     * @param {AiManEventBus} deps.eventBus
     * @param {Function} deps.aiAssistantClass — constructor for spawning background tasks
     * @param {object} [opts]
     * @param {number} [opts.intervalMs=60000] — default tick interval (milliseconds)
     */
    constructor({ schedulerService, taskManager, assistant, eventBus, aiAssistantClass }, opts = {}) {
        this.schedulerService = schedulerService;
        this.taskManager = taskManager;
        this.assistant = assistant;
        this.eventBus = eventBus || new AiManEventBus();
        this.aiAssistantClass = aiAssistantClass;

        // State
        this.state = 'stopped'; // 'stopped' | 'playing' | 'paused'
        this.intervalMs = opts.intervalMs || 180000;
        this.invocationCount = 0;

        // Internal timer
        this._timer = null;

        // Foreground activity tracking (updated externally by web-server)
        this.isForegroundBusy = false;
        this.lastForegroundActivity = Date.now();

        // Track current agent loop task for result injection
        this._currentTaskId = null;

        // Blocking questions: questionId -> { resolve, reject, question, taskId }
        this._pendingQuestions = new Map();

        // Listen for task completions to inject results into main chat
        this._setupTaskCompletionListener();
    }

    /**
     * Listen for agent-loop task completions and inject results into the main chat.
     */
    _setupTaskCompletionListener() {
        this.eventBus.on('task:completed', (data) => {
            if (!data.taskId) return;
            const task = this.taskManager.getTask(data.taskId);
            if (!task || !task.metadata?.tags?.includes('agent-loop')) return;

            this._injectResultIntoChat(task);
        });

        this.eventBus.on('task:failed', (data) => {
            if (!data.taskId) return;
            const task = this.taskManager.getTask(data.taskId);
            if (!task || !task.metadata?.tags?.includes('agent-loop')) return;

            consoleStyler.log('error', `Agent loop task ${data.taskId} failed: ${task.error}`);
        });

        // Listen for blocking question requests from background agents
        this.eventBus.on('agent-loop:question-request', (data) => {
            this._handleQuestionRequest(data);
        });
    }

    /**
     * Inject a completed agent-loop task result into the main foreground chat.
     * The result appears as a message from the "Background Agent".
     */
    _injectResultIntoChat(task) {
        if (!task.result || !this.assistant?.historyManager) return;

        const agentMessage = `🤖 **Message from Background Agent** (Invocation #${task.metadata?.invocationNumber || '?'}):\n\n${task.result}`;

        // Inject into the foreground assistant's history
        this.assistant.historyManager.addMessage('assistant', agentMessage);

        // Save conversation with the injected message
        this.assistant.saveConversation().catch(() => {});

        // Broadcast to UI as a chat message
        this.eventBus.emitTyped('agent-loop:chat-message', {
            id: `agent-loop-${Date.now()}`,
            role: 'ai',
            type: 'text',
            content: agentMessage,
            timestamp: new Date().toLocaleTimeString(),
            isAgentLoop: true,
            invocationNumber: task.metadata?.invocationNumber || null
        });

        consoleStyler.log('system', `🤖 Agent loop result injected into main chat (invocation #${task.metadata?.invocationNumber})`);
    }

    /**
     * Handle a blocking question request from a background agent.
     * Pauses the agent loop and emits the question to the UI.
     * @param {Object} data - { questionId, question, taskId }
     */
    _handleQuestionRequest(data) {
        const { questionId, question, taskId } = data;

        consoleStyler.log('system', `🤖❓ Background agent asking blocking question: ${question}`);

        // Pause the loop while waiting for answer
        if (this.state === 'playing') {
            this._stopTimer();
            consoleStyler.log('system', '⏸ Agent loop paused for blocking question');
        }

        // Inject the question into the main chat history
        if (this.assistant?.historyManager) {
            const questionMessage = `🤖❓ **Question from Background Agent:**\n\n${question}\n\n*Please respond to continue the background agent's work.*`;
            this.assistant.historyManager.addMessage('assistant', questionMessage);
            this.assistant.saveConversation().catch(() => {});
        }

        // Broadcast to UI
        this.eventBus.emitTyped('agent-loop:question', {
            questionId,
            question,
            taskId,
            timestamp: new Date().toLocaleTimeString()
        });
    }

    /**
     * Resolve a pending blocking question with the user's answer.
     * Resumes the agent loop if it was paused for the question.
     * @param {string} questionId
     * @param {string} answer
     */
    resolveQuestion(questionId, answer) {
        consoleStyler.log('system', `🤖✅ Blocking question ${questionId} answered: "${answer.substring(0, 50)}..."`);

        // Inject the answer into the main chat history
        if (this.assistant?.historyManager) {
            this.assistant.historyManager.addMessage('user', `[Answer to Background Agent]: ${answer}`);
            this.assistant.saveConversation().catch(() => {});
        }

        // Emit answer event so the background agent's tool can resolve
        this.eventBus.emitTyped(`agent-loop:answer:${questionId}`, { answer });

        // Resume the loop if it was playing before the question
        if (this.state === 'playing' && !this._timer) {
            this._startTimer();
            consoleStyler.log('system', '▶ Agent loop resumed after question answered');
        }
    }

    /**
     * Get all pending questions.
     * @returns {Array<{questionId: string, question: string, taskId: string}>}
     */
    getPendingQuestions() {
        return Array.from(this._pendingQuestions.values()).map(q => ({
            questionId: q.questionId,
            question: q.question,
            taskId: q.taskId
        }));
    }

    // ── Public API ─────────────────────────────────────────────

    /**
     * Start the autonomous loop.  Fires immediately, then every intervalMs.
     * @param {number} [intervalMs] — override interval (milliseconds)
     */
    async play(intervalMs) {
        if (intervalMs && intervalMs >= 5000) this.intervalMs = intervalMs;

        if (this.state === 'playing') {
            consoleStyler.log('system', '🔄 Agent loop already playing');
            return this.getState();
        }

        // If paused, just resume the timer
        if (this.state === 'paused') {
            return this.resume();
        }

        this.state = 'playing';
        this.invocationCount = 0;
        this._startTimer();

        consoleStyler.log('system', `▶ Agent loop started (every ${this.intervalMs / 1000}s)`);
        this._emitState();

        // Immediate first invocation
        this._tick();

        return this.getState();
    }

    /**
     * Pause the loop (timer stops, state preserved, can resume).
     */
    pause() {
        if (this.state !== 'playing') return this.getState();

        this._stopTimer();
        this.state = 'paused';

        consoleStyler.log('system', '⏸ Agent loop paused');
        this._emitState();
        return this.getState();
    }

    /**
     * Resume from paused state.  Fires immediately, then resumes timer.
     */
    async resume() {
        if (this.state !== 'paused') return this.getState();

        this.state = 'playing';
        this._startTimer();

        consoleStyler.log('system', '▶ Agent loop resumed');
        this._emitState();

        // Immediate invocation on resume
        this._tick();

        return this.getState();
    }

    /**
     * Stop the loop entirely.
     */
    stop() {
        if (this.state === 'stopped') return this.getState();

        this._stopTimer();
        this.state = 'stopped';

        consoleStyler.log('system', '⏹ Agent loop stopped');
        this._emitState();
        return this.getState();
    }

    /**
     * Update the tick interval.  If playing, restarts the timer with the new interval.
     * @param {number} intervalMs — must be >= 5000
     */
    async setInterval(intervalMs) {
        if (intervalMs < 5000) throw new Error('Interval must be at least 5 seconds');
        this.intervalMs = intervalMs;

        if (this.state === 'playing') {
            this._stopTimer();
            this._startTimer();
        }

        this._emitState();
        return this.getState();
    }

    /**
     * Return current state snapshot.
     */
    getState() {
        return {
            state: this.state,
            intervalMs: this.intervalMs,
            invocationCount: this.invocationCount,
            pendingQuestions: this.getPendingQuestions()
        };
    }

    /**
     * Update foreground activity tracking (called by web-server on chat events).
     * @param {boolean} busy
     */
    setForegroundBusy(busy) {
        this.isForegroundBusy = busy;
        if (busy) this.lastForegroundActivity = Date.now();
    }

    // ── Internal ───────────────────────────────────────────────

    _startTimer() {
        this._stopTimer();
        this._timer = setInterval(() => this._tick(), this.intervalMs);
    }

    _stopTimer() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /**
     * Execute one autonomous agent invocation.
     * Skips if the previous agent-loop task is still running — only ONE agent-loop
     * task runs at any time.
     */
    async _tick() {
        if (this.state !== 'playing') return;

        // Guard: skip if the previous agent-loop task is still running
        if (this._currentTaskId) {
            const currentTask = this.taskManager.getTask(this._currentTaskId);
            if (currentTask && (currentTask.status === 'running' || currentTask.status === 'queued')) {
                consoleStyler.log('system', `⏭ Agent loop skipping tick — previous task ${this._currentTaskId} still ${currentTask.status}`);
                return;
            }
        }

        this.invocationCount++;
        const invocationNum = this.invocationCount;

        consoleStyler.log('system', `🤖 Agent loop tick #${invocationNum}`);

        try {
            const briefingPacket = await this._buildBriefingPacket(invocationNum);

            // Spawn a background task with the briefing packet as the query
            const task = this.taskManager.spawnTask(
                briefingPacket,
                `[Agent Loop] Invocation #${invocationNum}`,
                this.aiAssistantClass,
                {
                    workingDir: this.assistant.workingDir,
                    metadata: {
                        type: 'agent-loop',
                        invocationNumber: invocationNum,
                        tags: ['agent-loop', 'autonomous']
                    }
                }
            );

            // Track the current task so we can skip next tick if it's still running
            this._currentTaskId = task.id;

            this.eventBus.emitTyped('agent-loop:invocation', {
                invocationNumber: invocationNum,
                state: this.state,
                foregroundBusy: this.isForegroundBusy,
                taskId: task.id
            });

        } catch (err) {
            consoleStyler.log('error', `Agent loop tick #${invocationNum} failed: ${err.message}`);
        }
    }

    /**
     * Assemble the briefing packet — structured context that gives
     * the background agent everything it needs to orient itself.
     * @param {number} invocationNum
     * @returns {Promise<string>}
     */
    async _buildBriefingPacket(invocationNum) {
        const sections = [];

        // ── Header ──
        sections.push(
            `[AUTONOMOUS AGENT LOOP — Invocation #${invocationNum}]`,
            `Timestamp: ${new Date().toISOString()}`,
            `Loop Interval: ${this.intervalMs / 1000} seconds`,
            ''
        );

        // ── Active Persona ──
        if (this.assistant.personaManager) {
            const persona = this.assistant.personaManager.getActivePersona();
            if (persona) {
                sections.push(`Active Persona: ${persona.name}`);
                sections.push('');
            }
        }

        // ── Current State ──
        sections.push('## Current State');
        sections.push(`- Working Directory: ${this.assistant.workingDir}`);

        const foregroundStatus = this.isForegroundBusy ? 'busy' : 'idle';
        const sinceActivity = Math.round((Date.now() - this.lastForegroundActivity) / 1000);
        sections.push(`- Foreground Status: ${foregroundStatus}`);
        sections.push(`- Last User Activity: ${sinceActivity} seconds ago`);
        sections.push('');

        // ── Recent Conversation Summary ──
        try {
            const recentHistory = this.assistant.historyManager.getLastExchanges(3);
            const conversationMsgs = recentHistory.filter(m => m.role === 'user' || m.role === 'assistant');
            if (conversationMsgs.length > 0) {
                sections.push('## Recent Foreground Conversation (last 3 exchanges)');
                for (const msg of conversationMsgs) {
                    const role = msg.role === 'user' ? 'User' : 'Assistant';
                    const content = (msg.content || '').substring(0, 300);
                    sections.push(`[${role}]: ${content}${(msg.content || '').length > 300 ? '...' : ''}`);
                }
                sections.push('');
            }
        } catch (e) {
            // Ignore history read errors
        }

        // ── Active Schedules & Recent Tasks ──
        try {
            const schedules = this.schedulerService.listSchedules('all');
            if (schedules.length > 0) {
                sections.push('## Active Schedules');
                for (const s of schedules) {
                    sections.push(`- [${s.status}] ${s.name}: last ran ${s.lastRunAt || 'never'}, runs: ${s.runCount}`);
                }
                sections.push('');
            }
        } catch (e) { /* ignore */ }

        try {
            const runningTasks = this.taskManager.listTasks('running')
                .filter(t => !(t.metadata?.tags || []).includes('agent-loop'));
            const recentCompleted = this.taskManager.listTasks('completed')
                .filter(t => !(t.metadata?.tags || []).includes('agent-loop'))
                .slice(-3);

            if (runningTasks.length > 0 || recentCompleted.length > 0) {
                sections.push('## Background Tasks');
                for (const t of runningTasks) {
                    sections.push(`- [RUNNING] ${t.description} (${t.progress}%)`);
                }
                for (const t of recentCompleted) {
                    const resultSnippet = t.result ? t.result.substring(0, 100) + '...' : t.error || 'no result';
                    sections.push(`- [DONE] ${t.description}: ${resultSnippet}`);
                }
                sections.push('');
            }
        } catch (e) { /* ignore */ }

        // ── Holographic Memory Recall ──
        try {
            if (this.assistant.resoLangService && this.assistant.personaManager) {
                const persona = this.assistant.personaManager.getActivePersona();
                const missionKeywords = (persona?.mission || [])
                    .map(m => m.label)
                    .join(' ');
                const query = missionKeywords || 'current projects goals priorities';

                const memories = await this.assistant.resoLangService.recall(query, 5);
                if (memories && memories.length > 0) {
                    sections.push('## Relevant Memory Context');
                    for (const m of memories) {
                        sections.push(`[Memory]: ${m.text.substring(0, 200)}${m.text.length > 200 ? '...' : ''}`);
                    }
                    sections.push('');
                }
            }
        } catch (e) { /* ignore */ }

        // ── Previous answers to blocking questions ──
        try {
            const answers = this._getRecentAnswers();
            if (answers.length > 0) {
                sections.push('## Answers to Previous Questions');
                for (const a of answers) {
                    sections.push(`Q: ${a.question}`);
                    sections.push(`A: ${a.answer}`);
                }
                sections.push('');
            }
        } catch (e) { /* ignore */ }

        // ── Directive ──
        sections.push('## Your Directive');
        sections.push('You are running autonomously as a background agent tick.');
        sections.push('Follow your persona\'s OODA loop: Observe the current state, Orient on priorities, Decide on the most impactful action, and Act.');
        sections.push('');
        sections.push('## Communication Protocol');
        sections.push('Your final response text will be injected directly into the user\'s main chat conversation as a message from the "Background Agent".');
        sections.push('Write your response AS IF you are speaking directly to the user. Be concise, clear, and actionable.');
        sections.push('If you have findings, updates, or recommendations, present them conversationally.');
        sections.push('');
        sections.push('### Blocking Questions');
        sections.push('If you ABSOLUTELY NEED information from the user to proceed with a critical task, use the `ask_blocking_question` tool.');
        sections.push('This will pause the agent loop and present your question in the user\'s chat. The loop resumes when they answer.');
        sections.push('ONLY ask blocking questions when you truly cannot proceed without the answer. Prefer to make reasonable assumptions.');
        sections.push('');

        if (this.isForegroundBusy) {
            sections.push('⚠️ The user is currently actively chatting in the foreground.');
            sections.push('LIMIT yourself to read-only observation and planning. Do NOT write files or create surfaces that could conflict with the foreground conversation.');
        } else {
            sections.push('The user is idle. You may take autonomous action — create surfaces, delegate to OpenClaw, file tasks, update plans, etc.');
        }

        return sections.join('\n');
    }

    /**
     * Get recent answers to blocking questions (for context injection).
     * @returns {Array<{question: string, answer: string}>}
     */
    _getRecentAnswers() {
        // Scan the foreground conversation history for Q&A pairs
        if (!this.assistant?.historyManager) return [];

        const history = this.assistant.historyManager.getHistory();
        const pairs = [];

        for (let i = 0; i < history.length; i++) {
            const msg = history[i];
            if (msg.role === 'assistant' && msg.content?.includes('Question from Background Agent')) {
                // Extract the question text
                const questionMatch = msg.content.match(/\*\*Question from Background Agent:\*\*\s*\n\n([\s\S]*?)\n\n\*/);
                if (questionMatch) {
                    // Look for the answer in the next user message
                    for (let j = i + 1; j < history.length; j++) {
                        if (history[j].role === 'user' && history[j].content?.includes('[Answer to Background Agent]')) {
                            const answer = history[j].content.replace('[Answer to Background Agent]: ', '');
                            pairs.push({ question: questionMatch[1], answer });
                            break;
                        }
                    }
                }
            }
        }

        return pairs.slice(-5); // Last 5 Q&A pairs
    }

    /**
     * Emit state-changed event to the event bus.
     */
    _emitState() {
        this.eventBus.emitTyped('agent-loop:state-changed', this.getState());
    }
}

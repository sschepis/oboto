/**
 * Unit tests for AgentLoopController
 * @see src/core/agent-loop-controller.mjs
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../ui/console-styler.mjs', () => ({
    consoleStyler: { log: jest.fn() }
}));

jest.unstable_mockModule('../../config.mjs', () => ({
    config: { ai: { maxTokens: 4096, contextWindowSize: 128000 } }
}));

const { AgentLoopController } = await import('../agent-loop-controller.mjs');

describe('AgentLoopController', () => {
    let controller;
    let mockTaskManager;
    let mockAssistant;
    let mockEventBus;
    let mockSchedulerService;
    let mockAiAssistantClass;

    beforeEach(() => {
        jest.useFakeTimers();

        mockTaskManager = {
            getTask: jest.fn().mockReturnValue(null),
            spawnTask: jest.fn().mockReturnValue({ id: 'task-123' }),
            listTasks: jest.fn().mockReturnValue([]),
        };

        mockAssistant = {
            workingDir: '/test/workspace',
            historyManager: {
                getHistory: jest.fn().mockReturnValue([]),
                getLastExchanges: jest.fn().mockReturnValue([]),
                addMessage: jest.fn(),
            },
            saveConversation: jest.fn().mockImplementation(async () => undefined),
            personaManager: null,
            resoLangService: null,
            consciousness: null,
        };

        mockEventBus = {
            on: jest.fn(),
            emit: jest.fn(),
            emitTyped: jest.fn(),
        };

        mockSchedulerService = {
            listSchedules: jest.fn().mockReturnValue([]),
        };

        mockAiAssistantClass = jest.fn();

        controller = new AgentLoopController(
            {
                schedulerService: mockSchedulerService,
                taskManager: mockTaskManager,
                assistant: mockAssistant,
                eventBus: mockEventBus,
                aiAssistantClass: mockAiAssistantClass,
            },
            { intervalMs: 60000 }
        );
    });

    afterEach(() => {
        controller.stop();
        jest.useRealTimers();
    });

    // ── Constructor ────────────────────────────────────────────────────

    describe('constructor', () => {
        it('initializes in stopped state', () => {
            expect(controller.state).toBe('stopped');
        });

        it('sets default interval', () => {
            expect(controller.intervalMs).toBe(60000);
        });

        it('starts with invocationCount at 0', () => {
            expect(controller.invocationCount).toBe(0);
        });

        it('stores dependency references', () => {
            expect(controller.taskManager).toBe(mockTaskManager);
            expect(controller.assistant).toBe(mockAssistant);
            expect(controller.eventBus).toBe(mockEventBus);
            expect(controller.schedulerService).toBe(mockSchedulerService);
        });

        it('initializes isForegroundBusy to false', () => {
            expect(controller.isForegroundBusy).toBe(false);
        });

        it('sets up task completion listener', () => {
            expect(mockEventBus.on).toHaveBeenCalledWith('task:completed', expect.any(Function));
            expect(mockEventBus.on).toHaveBeenCalledWith('task:failed', expect.any(Function));
            expect(mockEventBus.on).toHaveBeenCalledWith('agent-loop:question-request', expect.any(Function));
        });

        it('uses default interval when opts not provided', () => {
            const ctrl = new AgentLoopController({
                schedulerService: mockSchedulerService,
                taskManager: mockTaskManager,
                assistant: mockAssistant,
                eventBus: mockEventBus,
                aiAssistantClass: mockAiAssistantClass,
            });
            expect(ctrl.intervalMs).toBe(180000);
            ctrl.stop();
        });
    });

    // ── State Machine: play() ─────────────────────────────────────────

    describe('play()', () => {
        it('transitions state to playing', async () => {
            await controller.play();
            expect(controller.state).toBe('playing');
        });

        it('resets invocation count and fires immediate tick', async () => {
            controller.invocationCount = 5;
            await controller.play();
            expect(controller.invocationCount).toBe(1);
        });

        it('returns state snapshot', async () => {
            const result = await controller.play();
            expect(result).toHaveProperty('state', 'playing');
            expect(result).toHaveProperty('intervalMs');
            expect(result).toHaveProperty('invocationCount');
        });

        it('fires immediate tick on play', async () => {
            await controller.play();
            expect(controller.invocationCount).toBe(1);
            expect(mockTaskManager.spawnTask).toHaveBeenCalledTimes(1);
        });

        it('emits state-changed event', async () => {
            await controller.play();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'playing' })
            );
        });

        it('accepts interval override >= 5000', async () => {
            await controller.play(30000);
            expect(controller.intervalMs).toBe(30000);
        });

        it('ignores interval override less than 5000', async () => {
            await controller.play(1000);
            expect(controller.intervalMs).toBe(60000);
        });

        it('returns current state when already playing', async () => {
            await controller.play();
            const result = await controller.play();
            expect(result.state).toBe('playing');
            expect(mockTaskManager.spawnTask).toHaveBeenCalledTimes(1);
        });

        it('delegates to resume when called from paused state', async () => {
            await controller.play();
            controller.pause();
            mockTaskManager.spawnTask.mockClear();
            await controller.play();
            expect(controller.state).toBe('playing');
        });
    });

    // ── State Machine: pause() ────────────────────────────────────────

    describe('pause()', () => {
        it('transitions from playing to paused', async () => {
            await controller.play();
            controller.pause();
            expect(controller.state).toBe('paused');
        });

        it('stops the timer', async () => {
            await controller.play();
            controller.pause();
            expect(controller._timer).toBeNull();
        });

        it('preserves invocation count', async () => {
            await controller.play();
            const count = controller.invocationCount;
            controller.pause();
            expect(controller.invocationCount).toBe(count);
        });

        it('emits state-changed event', async () => {
            await controller.play();
            mockEventBus.emitTyped.mockClear();
            controller.pause();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'paused' })
            );
        });

        it('is a no-op when not playing', () => {
            const result = controller.pause();
            expect(result.state).toBe('stopped');
        });

        it('is a no-op when already paused', async () => {
            await controller.play();
            controller.pause();
            const result = controller.pause();
            expect(result.state).toBe('paused');
        });
    });

    // ── State Machine: resume() ───────────────────────────────────────

    describe('resume()', () => {
        it('transitions from paused to playing', async () => {
            await controller.play();
            controller.pause();
            await controller.resume();
            expect(controller.state).toBe('playing');
        });

        it('restarts the timer', async () => {
            await controller.play();
            controller.pause();
            await controller.resume();
            expect(controller._timer).not.toBeNull();
        });

        it('fires immediate tick on resume', async () => {
            await controller.play();
            controller.pause();
            mockTaskManager.spawnTask.mockClear();
            await controller.resume();
            expect(mockTaskManager.spawnTask).toHaveBeenCalled();
        });

        it('emits state-changed event', async () => {
            await controller.play();
            controller.pause();
            mockEventBus.emitTyped.mockClear();
            await controller.resume();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'playing' })
            );
        });

        it('is a no-op when not paused', async () => {
            const result = await controller.resume();
            expect(result.state).toBe('stopped');
        });
    });

    // ── State Machine: stop() ─────────────────────────────────────────

    describe('stop()', () => {
        it('transitions to stopped state', async () => {
            await controller.play();
            controller.stop();
            expect(controller.state).toBe('stopped');
        });

        it('stops the timer', async () => {
            await controller.play();
            controller.stop();
            expect(controller._timer).toBeNull();
        });

        it('emits state-changed event', async () => {
            await controller.play();
            mockEventBus.emitTyped.mockClear();
            controller.stop();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'stopped' })
            );
        });

        it('is a no-op when already stopped', () => {
            const result = controller.stop();
            expect(result.state).toBe('stopped');
        });

        it('works from paused state', async () => {
            await controller.play();
            controller.pause();
            controller.stop();
            expect(controller.state).toBe('stopped');
        });
    });

    // ── setInterval() ─────────────────────────────────────────────────

    describe('setInterval()', () => {
        it('updates the interval', async () => {
            await controller.setInterval(30000);
            expect(controller.intervalMs).toBe(30000);
        });

        it('throws for interval < 5000ms', async () => {
            await expect(controller.setInterval(1000)).rejects.toThrow('at least 5 seconds');
        });

        it('restarts timer if currently playing', async () => {
            await controller.play();
            const oldTimer = controller._timer;
            await controller.setInterval(30000);
            expect(controller._timer).not.toBe(oldTimer);
        });

        it('emits state-changed event', async () => {
            mockEventBus.emitTyped.mockClear();
            await controller.setInterval(30000);
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.any(Object)
            );
        });

        it('returns state snapshot', async () => {
            const result = await controller.setInterval(30000);
            expect(result.intervalMs).toBe(30000);
        });
    });

    // ── getState() ────────────────────────────────────────────────────

    describe('getState()', () => {
        it('returns current state snapshot', () => {
            const state = controller.getState();
            expect(state).toHaveProperty('state', 'stopped');
            expect(state).toHaveProperty('intervalMs', 60000);
            expect(state).toHaveProperty('invocationCount', 0);
            expect(state).toHaveProperty('pendingQuestions');
            expect(Array.isArray(state.pendingQuestions)).toBe(true);
        });

        it('reflects state changes', async () => {
            await controller.play();
            expect(controller.getState().state).toBe('playing');
            controller.pause();
            expect(controller.getState().state).toBe('paused');
            controller.stop();
            expect(controller.getState().state).toBe('stopped');
        });
    });

    // ── setForegroundBusy() ───────────────────────────────────────────

    describe('setForegroundBusy()', () => {
        it('sets isForegroundBusy flag', () => {
            controller.setForegroundBusy(true);
            expect(controller.isForegroundBusy).toBe(true);
        });

        it('clears isForegroundBusy flag', () => {
            controller.setForegroundBusy(true);
            controller.setForegroundBusy(false);
            expect(controller.isForegroundBusy).toBe(false);
        });

        it('updates lastForegroundActivity when set to busy', () => {
            const before = controller.lastForegroundActivity;
            jest.advanceTimersByTime(1000);
            controller.setForegroundBusy(true);
            expect(controller.lastForegroundActivity).toBeGreaterThanOrEqual(before);
        });
    });

    // ── _tick() ───────────────────────────────────────────────────────

    describe('_tick()', () => {
        it('skips when state is not playing', async () => {
            await controller._tick();
            expect(mockTaskManager.spawnTask).not.toHaveBeenCalled();
        });

        it('skips when previous task is still running', async () => {
            await controller.play();
            mockTaskManager.spawnTask.mockClear();

            controller._currentTaskId = 'running-task';
            mockTaskManager.getTask.mockReturnValue({ status: 'running' });

            await controller._tick();
            expect(mockTaskManager.spawnTask).not.toHaveBeenCalled();
        });

        it('skips when previous task is queued', async () => {
            await controller.play();
            mockTaskManager.spawnTask.mockClear();

            controller._currentTaskId = 'queued-task';
            mockTaskManager.getTask.mockReturnValue({ status: 'queued' });

            await controller._tick();
            expect(mockTaskManager.spawnTask).not.toHaveBeenCalled();
        });

        it('proceeds when previous task is completed', async () => {
            await controller.play();
            mockTaskManager.spawnTask.mockClear();

            controller._currentTaskId = 'done-task';
            mockTaskManager.getTask.mockReturnValue({ status: 'completed' });

            await controller._tick();
            expect(mockTaskManager.spawnTask).toHaveBeenCalled();
        });

        it('emits agent-loop:invocation event', async () => {
            await controller.play();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:invocation',
                expect.objectContaining({
                    invocationNumber: 1,
                    taskId: 'task-123',
                })
            );
        });

        it('stores current task id', async () => {
            await controller.play();
            expect(controller._currentTaskId).toBe('task-123');
        });

        it('handles spawnTask errors gracefully', async () => {
            mockTaskManager.spawnTask.mockImplementation(() => {
                throw new Error('spawn failed');
            });
            await controller.play();
            expect(controller.state).toBe('playing');
        });
    });

    // ── Timer behavior ────────────────────────────────────────────────

    describe('timer behavior', () => {
        it('fires tick at regular intervals', async () => {
            await controller.play();
            mockTaskManager.spawnTask.mockClear();
            controller._currentTaskId = null;
            mockTaskManager.getTask.mockReturnValue(null);

            jest.advanceTimersByTime(60000);
            await Promise.resolve();

            expect(mockTaskManager.spawnTask).toHaveBeenCalled();
        });

        it('does not fire ticks after stop', async () => {
            await controller.play();
            controller.stop();
            mockTaskManager.spawnTask.mockClear();

            jest.advanceTimersByTime(120000);

            expect(mockTaskManager.spawnTask).not.toHaveBeenCalled();
        });

        it('does not fire ticks while paused', async () => {
            await controller.play();
            controller.pause();
            mockTaskManager.spawnTask.mockClear();

            jest.advanceTimersByTime(120000);

            expect(mockTaskManager.spawnTask).not.toHaveBeenCalled();
        });
    });

    // ── resolveQuestion() ─────────────────────────────────────────────

    describe('resolveQuestion()', () => {
        it('injects the answer into the main chat history', () => {
            controller.resolveQuestion('q1', 'The answer is 42');
            expect(mockAssistant.historyManager.addMessage).toHaveBeenCalledWith(
                'user',
                expect.stringContaining('42')
            );
        });

        it('emits answer event on the event bus', () => {
            controller.resolveQuestion('q1', 'yes');
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:answer:q1',
                { answer: 'yes' }
            );
        });

        it('saves the conversation after injecting the answer', () => {
            controller.resolveQuestion('q1', 'answer');
            expect(mockAssistant.saveConversation).toHaveBeenCalled();
        });

        it('resumes timer if state is playing but timer is null', async () => {
            await controller.play();
            controller._stopTimer();
            expect(controller._timer).toBeNull();

            controller.resolveQuestion('q1', 'answer');
            expect(controller._timer).not.toBeNull();
        });
    });

    // ── getPendingQuestions() ──────────────────────────────────────────

    describe('getPendingQuestions()', () => {
        it('returns empty array initially', () => {
            expect(controller.getPendingQuestions()).toEqual([]);
        });

        it('returns pending questions when present', () => {
            controller._pendingQuestions.set('q1', {
                questionId: 'q1',
                question: 'What color?',
                taskId: 'task-1'
            });
            const questions = controller.getPendingQuestions();
            expect(questions).toHaveLength(1);
            expect(questions[0].questionId).toBe('q1');
            expect(questions[0].question).toBe('What color?');
        });
    });

    // ── Event emissions ───────────────────────────────────────────────

    describe('event emissions', () => {
        it('emits agent-loop:state-changed on play', async () => {
            await controller.play();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'playing' })
            );
        });

        it('emits agent-loop:state-changed on pause', async () => {
            await controller.play();
            mockEventBus.emitTyped.mockClear();
            controller.pause();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'paused' })
            );
        });

        it('emits agent-loop:state-changed on stop', async () => {
            await controller.play();
            mockEventBus.emitTyped.mockClear();
            controller.stop();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:state-changed',
                expect.objectContaining({ state: 'stopped' })
            );
        });

        it('emits agent-loop:invocation on tick', async () => {
            await controller.play();
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:invocation',
                expect.objectContaining({
                    invocationNumber: expect.any(Number),
                    state: 'playing',
                    taskId: expect.any(String),
                })
            );
        });
    });

    // ── _injectResultIntoChat() ───────────────────────────────────────

    describe('_injectResultIntoChat()', () => {
        it('injects task result into the foreground history', () => {
            const task = {
                result: 'Background work complete',
                metadata: { invocationNumber: 5 },
            };
            controller._injectResultIntoChat(task);
            expect(mockAssistant.historyManager.addMessage).toHaveBeenCalledWith(
                'assistant',
                expect.stringContaining('Background work complete')
            );
        });

        it('emits agent-loop:chat-message event', () => {
            const task = {
                result: 'Done',
                metadata: { invocationNumber: 1 },
            };
            controller._injectResultIntoChat(task);
            expect(mockEventBus.emitTyped).toHaveBeenCalledWith(
                'agent-loop:chat-message',
                expect.objectContaining({
                    role: 'ai',
                    isAgentLoop: true,
                })
            );
        });

        it('skips if task has no result', () => {
            controller._injectResultIntoChat({ metadata: {} });
            expect(mockAssistant.historyManager.addMessage).not.toHaveBeenCalled();
        });

        it('skips if assistant has no historyManager', () => {
            controller.assistant = { historyManager: null };
            const task = { result: 'test', metadata: {} };
            expect(() => controller._injectResultIntoChat(task)).not.toThrow();
        });
    });

    // ── Full lifecycle ────────────────────────────────────────────────

    describe('full lifecycle', () => {
        it('play → pause → resume → stop transitions correctly', async () => {
            await controller.play();
            expect(controller.state).toBe('playing');
            expect(controller._timer).not.toBeNull();

            controller.pause();
            expect(controller.state).toBe('paused');
            expect(controller._timer).toBeNull();

            await controller.resume();
            expect(controller.state).toBe('playing');
            expect(controller._timer).not.toBeNull();

            controller.stop();
            expect(controller.state).toBe('stopped');
            expect(controller._timer).toBeNull();
        });
    });
});

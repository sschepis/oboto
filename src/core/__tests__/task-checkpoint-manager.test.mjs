/**
 * Tests for TaskCheckpointManager and CheckpointStore
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CheckpointStore } from '../checkpoint-store.mjs';
import { TaskCheckpointManager } from '../task-checkpoint-manager.mjs';
import { AiManEventBus } from '../../lib/event-bus.mjs';

// Mock consoleStyler to avoid console noise in tests
jest.mock('../../ui/console-styler.mjs', () => ({
    consoleStyler: {
        log: jest.fn()
    }
}));

describe('CheckpointStore', () => {
    let testDir;
    let store;

    beforeEach(async () => {
        // Create a temporary test directory
        testDir = path.join(os.tmpdir(), `checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await fs.promises.mkdir(testDir, { recursive: true });
        store = new CheckpointStore(testDir);
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    test('creates checkpoints directory on construction', () => {
        const checkpointsDir = path.join(testDir, '.oboto', 'checkpoints');
        expect(fs.existsSync(checkpointsDir)).toBe(true);
    });

    test('saves and loads a checkpoint', async () => {
        const taskId = 'test-task-123';
        const checkpoint = {
            taskId,
            type: 'background',
            status: 'running',
            description: 'Test task',
            query: 'Do something',
            turnNumber: 5,
            progress: 50
        };

        const saved = await store.saveCheckpoint(taskId, checkpoint);
        expect(saved).toBe(true);

        const loaded = await store.loadCheckpoint(taskId);
        expect(loaded).toBeTruthy();
        expect(loaded.taskId).toBe(taskId);
        expect(loaded.type).toBe('background');
        expect(loaded.turnNumber).toBe(5);
        expect(loaded._meta).toBeDefined();
        expect(loaded._meta.version).toBe(1);
    });

    test('deletes a checkpoint', async () => {
        const taskId = 'test-task-delete';
        await store.saveCheckpoint(taskId, { taskId, status: 'running' });
        
        let loaded = await store.loadCheckpoint(taskId);
        expect(loaded).toBeTruthy();

        const deleted = await store.deleteCheckpoint(taskId);
        expect(deleted).toBe(true);

        loaded = await store.loadCheckpoint(taskId);
        expect(loaded).toBeNull();
    });

    test('lists recoverable checkpoints', async () => {
        // Save multiple checkpoints with different states
        await store.saveCheckpoint('running-1', { taskId: 'running-1', status: 'running' });
        await store.saveCheckpoint('queued-1', { taskId: 'queued-1', status: 'queued' });
        await store.saveCheckpoint('completed-1', { taskId: 'completed-1', status: 'completed' });

        const recoverable = await store.listRecoverableCheckpoints();
        
        // Only running and queued tasks should be recoverable
        expect(recoverable.length).toBe(2);
        const taskIds = recoverable.map(r => r.taskId);
        expect(taskIds).toContain('running-1');
        expect(taskIds).toContain('queued-1');
        expect(taskIds).not.toContain('completed-1');
    });

    test('marks checkpoint as completed', async () => {
        const taskId = 'test-complete';
        await store.saveCheckpoint(taskId, { taskId, status: 'running' });
        
        await store.markCompleted(taskId, false);
        
        // Checkpoint should be deleted
        const loaded = await store.loadCheckpoint(taskId);
        expect(loaded).toBeNull();
    });

    test('marks checkpoint as completed but keeps file', async () => {
        const taskId = 'test-complete-keep';
        await store.saveCheckpoint(taskId, { taskId, status: 'running' });
        
        await store.markCompleted(taskId, true);
        
        // Checkpoint file should still exist
        const loaded = await store.loadCheckpoint(taskId);
        expect(loaded).toBeTruthy();

        // But manifest should show it as completed
        const manifest = await store._loadManifest();
        expect(manifest.tasks[taskId].state).toBe('completed');
    });

    test('WAL replay recovers from partial writes', async () => {
        // Manually create a WAL entry
        const walPath = path.join(testDir, '.oboto', 'checkpoints', 'wal.json');
        const walEntry = [{
            operation: 'write',
            taskId: 'wal-test',
            timestamp: Date.now(),
            data: {
                taskId: 'wal-test',
                status: 'running',
                description: 'WAL recovery test',
                _meta: { taskId: 'wal-test', savedAt: new Date().toISOString(), version: 1 }
            }
        }];
        await fs.promises.writeFile(walPath, JSON.stringify(walEntry));

        // Replay WAL
        const result = await store.replayWAL();
        expect(result.replayed).toBe(1);
        expect(result.errors.length).toBe(0);

        // Checkpoint should exist now
        const loaded = await store.loadCheckpoint('wal-test');
        expect(loaded).toBeTruthy();
        expect(loaded.description).toBe('WAL recovery test');

        // WAL should be cleared
        expect(fs.existsSync(walPath)).toBe(false);
    });

    test('switchWorkspace updates paths', () => {
        const newDir = path.join(os.tmpdir(), 'new-workspace');
        store.switchWorkspace(newDir);
        
        expect(store.workingDir).toBe(newDir);
        expect(store.checkpointsDir).toContain(newDir);
    });
});

describe('TaskCheckpointManager', () => {
    let testDir;
    let eventBus;
    let mockTaskManager;
    let manager;

    beforeEach(async () => {
        testDir = path.join(os.tmpdir(), `checkpoint-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await fs.promises.mkdir(testDir, { recursive: true });
        
        eventBus = new AiManEventBus();
        
        // Mock TaskManager
        mockTaskManager = {
            tasks: new Map(),
            getTask: jest.fn((id) => mockTaskManager.tasks.get(id)),
            listTasks: jest.fn((filter) => {
                const all = Array.from(mockTaskManager.tasks.values());
                return filter === 'all' ? all : all.filter(t => t.status === filter);
            }),
            spawnTask: jest.fn((query, description, aiClass, opts) => {
                const task = {
                    id: `task-${Date.now()}`,
                    query,
                    description,
                    status: 'running',
                    metadata: opts.metadata
                };
                mockTaskManager.tasks.set(task.id, task);
                return task;
            })
        };

        manager = new TaskCheckpointManager({
            eventBus,
            taskManager: mockTaskManager,
            workingDir: testDir,
            aiAssistantClass: class MockAssistant {}
        }, {
            enabled: true,
            intervalMs: 100, // Fast interval for testing
            recoverOnStartup: false // Don't auto-recover in tests
        });
    });

    afterEach(async () => {
        if (manager) {
            await manager.shutdown();
        }
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    test('initializes without errors', async () => {
        await manager.initialize();
        expect(manager._initialized).toBe(true);
    });

    test('checkpoints a task', async () => {
        await manager.initialize();
        
        const task = {
            id: 'task-checkpoint-test',
            status: 'running',
            description: 'Test task for checkpointing',
            query: 'Do something useful',
            progress: 25,
            outputLog: ['line 1', 'line 2'],
            metadata: { type: 'background' }
        };
        mockTaskManager.tasks.set(task.id, task);

        const success = await manager.checkpointTask(task.id);
        expect(success).toBe(true);

        // Verify checkpoint was saved
        const checkpoint = await manager.store.loadCheckpoint(task.id);
        expect(checkpoint).toBeTruthy();
        expect(checkpoint.description).toBe('Test task for checkpointing');
        expect(checkpoint.progress).toBe(25);
    });

    test('starts periodic checkpointing on task:started event', async () => {
        await manager.initialize();
        
        const task = {
            id: 'task-periodic-test',
            status: 'running',
            description: 'Periodic checkpoint test',
            query: 'Periodic task',
            metadata: {}
        };
        mockTaskManager.tasks.set(task.id, task);

        // Emit task:started event
        eventBus.emit('task:started', { taskId: task.id });

        // Wait for periodic checkpoint
        await new Promise(resolve => setTimeout(resolve, 150));

        // Verify checkpoint exists
        const checkpoint = await manager.store.loadCheckpoint(task.id);
        expect(checkpoint).toBeTruthy();
    });

    test('cleans up checkpoint on task:completed event', async () => {
        await manager.initialize();
        
        const task = {
            id: 'task-cleanup-test',
            status: 'running',
            description: 'Cleanup test',
            query: 'Test',
            metadata: {}
        };
        mockTaskManager.tasks.set(task.id, task);

        // Create checkpoint
        await manager.checkpointTask(task.id);
        let checkpoint = await manager.store.loadCheckpoint(task.id);
        expect(checkpoint).toBeTruthy();

        // Emit task:completed event
        eventBus.emit('task:completed', { taskId: task.id });

        // Wait for event handler
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify checkpoint was cleared
        checkpoint = await manager.store.loadCheckpoint(task.id);
        expect(checkpoint).toBeNull();
    });

    test('recovers background tasks on startup', async () => {
        // Manually create a checkpoint
        await manager.store.saveCheckpoint('recovered-task', {
            taskId: 'recovered-task',
            type: 'background',
            status: 'running',
            description: 'Task to recover',
            query: 'Original query',
            turnNumber: 3,
            progress: 50,
            outputLog: ['log1', 'log2']
        });

        // Initialize with recovery enabled
        manager.config.recoverOnStartup = true;
        await manager.initialize();

        // Check that a new task was spawned
        expect(mockTaskManager.spawnTask).toHaveBeenCalled();
        const spawnCall = mockTaskManager.spawnTask.mock.calls[0];
        expect(spawnCall[1]).toContain('[RECOVERED]');
    });

    test('queues request-type checkpoints for manual recovery', async () => {
        // Manually create a request checkpoint
        await manager.store.saveCheckpoint('request-123', {
            taskId: 'request-123',
            type: 'request',
            status: 'running',
            userInput: 'Please help me',
            turnNumber: 5,
            historySnapshot: [{ role: 'user', content: 'Help' }]
        });

        manager.config.recoverOnStartup = true;
        await manager.initialize();

        // Request should be queued, not auto-recovered
        const pending = manager.getPendingRecovery();
        expect(pending.length).toBe(1);
        expect(pending[0].taskId).toBe('request-123');
    });

    test('getStats returns expected structure', async () => {
        await manager.initialize();
        
        const stats = manager.getStats();
        expect(stats).toHaveProperty('enabled');
        expect(stats).toHaveProperty('intervalMs');
        expect(stats).toHaveProperty('activeCheckpoints');
        expect(stats).toHaveProperty('pendingRecovery');
        expect(stats.enabled).toBe(true);
    });
});

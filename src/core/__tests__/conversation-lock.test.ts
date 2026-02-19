/**
 * Tests for ConversationLock — per-conversation serialization.
 */

class TestConversationLock {
    private locks: Map<string, Promise<any>> = new Map();

    async acquire<T>(conversationName: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.locks.get(conversationName) || Promise.resolve();

        const current = prev.then(
            () => fn(),
            () => fn()  // Run even if previous failed
        );

        // Wrap to prevent unhandled rejection on the stored promise
        const stored = current.then(() => {}, () => {});
        this.locks.set(conversationName, stored);

        try {
            return await current;
        } finally {
            // Clean up if this is the last in the chain
            if (this.locks.get(conversationName) === stored) {
                this.locks.delete(conversationName);
            }
        }
    }

    isLocked(conversationName: string): boolean {
        return this.locks.has(conversationName);
    }
}

describe('ConversationLock', () => {
    test('acquire runs function immediately when unlocked', async () => {
        const lock = new TestConversationLock();
        const result = await lock.acquire('conv1', async () => 'done');
        expect(result).toBe('done');
    });

    test('serializes concurrent calls on the same conversation', async () => {
        const lock = new TestConversationLock();
        const order: string[] = [];

        const p1 = lock.acquire('conv1', async () => {
            order.push('start-1');
            await new Promise(r => setTimeout(r, 50));
            order.push('end-1');
            return 'result-1';
        });

        const p2 = lock.acquire('conv1', async () => {
            order.push('start-2');
            await new Promise(r => setTimeout(r, 10));
            order.push('end-2');
            return 'result-2';
        });

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBe('result-1');
        expect(r2).toBe('result-2');
        // p2 should not start until p1 finishes
        expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });

    test('allows parallel execution for different conversations', async () => {
        const lock = new TestConversationLock();
        const order: string[] = [];

        const p1 = lock.acquire('conv-A', async () => {
            order.push('start-A');
            await new Promise(r => setTimeout(r, 50));
            order.push('end-A');
            return 'A';
        });

        const p2 = lock.acquire('conv-B', async () => {
            order.push('start-B');
            await new Promise(r => setTimeout(r, 10));
            order.push('end-B');
            return 'B';
        });

        const [rA, rB] = await Promise.all([p1, p2]);

        expect(rA).toBe('A');
        expect(rB).toBe('B');
        // B should start before A ends (parallel)
        expect(order.indexOf('start-B')).toBeLessThan(order.indexOf('end-A'));
    });

    test('isLocked returns correct state', async () => {
        const lock = new TestConversationLock();
        expect(lock.isLocked('conv1')).toBe(false);

        let resolve: () => void;
        const held = new Promise<void>(r => { resolve = r; });

        const p = lock.acquire('conv1', async () => {
            await held;
            return 'ok';
        });

        // Give the acquire a tick to start
        await new Promise(r => setTimeout(r, 5));
        expect(lock.isLocked('conv1')).toBe(true);

        resolve!();
        await p;
        expect(lock.isLocked('conv1')).toBe(false);
    });

    test('error in function releases the lock', async () => {
        const lock = new TestConversationLock();

        await expect(
            lock.acquire('conv1', async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');

        // Should be able to acquire again
        const result = await lock.acquire('conv1', async () => 'recovered');
        expect(result).toBe('recovered');
    });
});

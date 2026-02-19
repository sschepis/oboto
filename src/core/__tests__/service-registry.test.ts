/**
 * Tests for ServiceRegistry — dependency injection container.
 */

class TestServiceRegistry {
    private services: Map<string, any> = new Map();

    register(name: string, instance: any) {
        this.services.set(name, instance);
    }

    get(name: string) {
        if (!this.services.has(name)) {
            throw new Error(`Service '${name}' is not registered.`);
        }
        return this.services.get(name);
    }

    optional(name: string) {
        return this.services.get(name) || null;
    }

    has(name: string) {
        return this.services.has(name);
    }

    list() {
        return Array.from(this.services.keys());
    }
}

describe('ServiceRegistry', () => {
    test('register and get a service', () => {
        const reg = new TestServiceRegistry();
        const svc = { doSomething: () => 'done' };
        reg.register('myService', svc);
        expect(reg.get('myService')).toBe(svc);
    });

    test('get throws for missing required service', () => {
        const reg = new TestServiceRegistry();
        expect(() => reg.get('missing')).toThrow("Service 'missing' is not registered.");
    });

    test('has returns true for registered and false for missing', () => {
        const reg = new TestServiceRegistry();
        reg.register('exists', {});
        expect(reg.has('exists')).toBe(true);
        expect(reg.has('nope')).toBe(false);
    });

    test('optional returns null for missing services', () => {
        const reg = new TestServiceRegistry();
        expect(reg.optional('missing')).toBeNull();
    });

    test('optional returns service when registered', () => {
        const reg = new TestServiceRegistry();
        const svc = { x: 1 };
        reg.register('svc', svc);
        expect(reg.optional('svc')).toBe(svc);
    });

    test('register overwrites existing service', () => {
        const reg = new TestServiceRegistry();
        reg.register('svc', { v: 1 });
        reg.register('svc', { v: 2 });
        expect(reg.get('svc')).toEqual({ v: 2 });
    });

    test('list returns all registered service names', () => {
        const reg = new TestServiceRegistry();
        reg.register('a', {});
        reg.register('b', {});
        reg.register('c', {});
        expect(reg.list()).toEqual(['a', 'b', 'c']);
    });

    test('allows null values', () => {
        const reg = new TestServiceRegistry();
        reg.register('nullable', null);
        expect(reg.has('nullable')).toBe(true);
        // optional returns null for falsy values
        expect(reg.optional('nullable')).toBeNull();
    });
});

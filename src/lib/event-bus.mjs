import { EventEmitter } from 'node:events';

/**
 * Typed event bus for AiMan lifecycle events.
 */
export class AiManEventBus extends EventEmitter {
    constructor() {
        super();
    }

    emitTyped(event, payload) {
        this.emit(event, { ...payload, timestamp: Date.now() });
    }
}

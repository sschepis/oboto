import { ConsoleStatusAdapter } from '../lib/adapters/console-status-adapter.mjs';

export class ServerStatusAdapter extends ConsoleStatusAdapter {
    constructor(eventBus) {
        super();
        this.eventBus = eventBus;
    }

    log(level, message, metadata = {}) {
        super.log(level, message, metadata); // Keep console output
        this.eventBus.emitTyped('server:log', { level, message, metadata });
    }

    onProgress(progress, status) {
        super.onProgress(progress, status);
        this.eventBus.emitTyped('server:progress', { progress, status });
    }

    onToolStart(toolName, args) {
        super.onToolStart(toolName, args);
        this.eventBus.emitTyped('server:tool-start', { toolName, args });
    }

    onToolEnd(toolName, result) {
        super.onToolEnd(toolName, result);
        this.eventBus.emitTyped('server:tool-end', { toolName, result });
    }
}

/**
 * Type declarations for console-styler.mjs
 */

export interface ConsoleStylerInstance {
    log(type: string, content: string, options?: Record<string, unknown>): void;
    logError(type: string, message: string, errorObj?: unknown, options?: Record<string, unknown>): void;
    formatMessage(type: string, content: string, options?: Record<string, unknown>): string;
    formatError(error: Error, context?: { suggestions?: string[] }): string;
    formatTodoList(todoData: { task: string; items: Array<{ status: string; step: string; result?: string }> }): string;
    setTheme(themeName: string): boolean;
    getTheme(): Record<string, (text: string) => string>;
    setListener(listener: { log: (...args: unknown[]) => void } | null): void;
    displayStartupBanner(workingDir: string): void;
    displayFinalResponse(content: string): void;
    createSpinner(text: string, type?: string): unknown;
    startSpinner(name: string, text: string, type?: string): unknown;
    updateSpinner(name: string, text: string): void;
    succeedSpinner(name: string, text: string): void;
    failSpinner(name: string, text: string): void;
    clearAllSpinners(): void;
    getAvailableThemes(): string[];
    formatMarkdown(content: string): string;
    createProgressBar(total: number, current?: number): string;
    applyGradient(text: string, colors: string[]): string;
    getBoxColor(type: string): string;
}

/** The ConsoleStyler class — use the exported singleton `consoleStyler` in most cases. */
export declare class ConsoleStyler implements ConsoleStylerInstance {
    constructor(theme?: string);
    log(type: string, content: string, options?: Record<string, unknown>): void;
    logError(type: string, message: string, errorObj?: unknown, options?: Record<string, unknown>): void;
    formatMessage(type: string, content: string, options?: Record<string, unknown>): string;
    formatError(error: Error, context?: { suggestions?: string[] }): string;
    formatTodoList(todoData: { task: string; items: Array<{ status: string; step: string; result?: string }> }): string;
    setTheme(themeName: string): boolean;
    getTheme(): Record<string, (text: string) => string>;
    setListener(listener: { log: (...args: unknown[]) => void } | null): void;
    displayStartupBanner(workingDir: string): void;
    displayFinalResponse(content: string): void;
    createSpinner(text: string, type?: string): unknown;
    startSpinner(name: string, text: string, type?: string): unknown;
    updateSpinner(name: string, text: string): void;
    succeedSpinner(name: string, text: string): void;
    failSpinner(name: string, text: string): void;
    clearAllSpinners(): void;
    getAvailableThemes(): string[];
    formatMarkdown(content: string): string;
    createProgressBar(total: number, current?: number): string;
    applyGradient(text: string, colors: string[]): string;
    getBoxColor(type: string): string;
}

/** Pre-initialized singleton instance — use this for all logging. */
export declare const consoleStyler: ConsoleStylerInstance;

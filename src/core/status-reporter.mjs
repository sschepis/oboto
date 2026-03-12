/**
 * Status Reporter — generates human-readable status descriptions
 * for tool calls and agent lifecycle events, then emits them as
 * 'status' log entries through consoleStyler.
 *
 * The 'status' log type is rendered prominently in the ThinkingIndicator
 * so the user always knows what the agent is currently doing.
 */

import { consoleStyler } from '../ui/console-styler.mjs';

/**
 * Map of tool names → functions that produce a human-readable description
 * from the tool arguments. Falls back to a generic description.
 */
const TOOL_STATUS_MAP = {
    // File tools
    read_file:    (a) => `Reading ${_short(a.path)}`,
    write_file:   (a) => `Writing to ${_short(a.path)}`,
    edit_file:    (a) => `Editing ${_short(a.path)}`,
    list_files:   (a) => `Listing files in ${_short(a.path || '.')}`,
    run_command:  (a) => `Running command: ${_truncate(a.command, 60)}`,

    // Web / Search
    search_web:   (a) => `Searching the web for "${_truncate(a.query, 50)}"`,
    browse_open:  (a) => `Opening browser: ${_truncate(a.url, 60)}`,
    browse_act:   (a) => `Performing browser action: ${a.action || 'interact'}`,
    browse_screenshot: () => `Taking browser screenshot`,
    browse_close: () => `Closing browser`,

    // Firecrawl
    firecrawl_scrape: (a) => `Scraping ${_truncate(a.url, 50)}`,
    firecrawl_crawl:  (a) => `Crawling ${_truncate(a.url, 50)}`,

    // Recursive / Async
    call_ai_assistant: (a) => `Delegating sub-task: ${_truncate(a.context || a.query, 50)}`,
    spawn_background_task: (a) => `Spawning background task: ${_truncate(a.description || a.query, 50)}`,
    check_task_status: (a) => `Checking task ${_short(a.task_id)}`,

    // Structured Dev
    init_structured_dev: () => `Initializing structured development`,
    bootstrap_project:  (a) => `Bootstrapping project: ${_truncate(a.project_name || '', 40)}`,
    read_manifest:      () => `Reading project manifest`,
    create_implementation_plan: (a) => `Creating implementation plan for: ${_truncate(a.feature_name || '', 40)}`,
    execute_implementation_plan: (a) => `Executing implementation plan: ${_truncate(a.plan_name || '', 40)}`,
    generate_enhancements: () => `Generating enhancement suggestions`,
    implement_enhancements: () => `Implementing enhancements`,
    visualize_architecture: () => `Visualizing architecture`,

    // Surfaces
    create_surface: (a) => `Creating surface: ${a.name || 'untitled'}`,
    update_surface_component: (a) => `Updating surface component: ${a.component_name || ''}`,
    delete_surface: () => `Deleting surface`,

    // Memory
    promote_memory:      (a) => `Promoting to long-term memory: ${_truncate(a.content || '', 40)}`,
    query_global_memory: (a) => `Querying memory: ${_truncate(a.query || '', 40)}`,

    // Workflow
    create_todo_list:   (a) => `Creating task list: ${_truncate(a.task || '', 40)}`,
    update_todo_status: (a) => `Updating task: ${_truncate(a.step || '', 40)}`,
    speak_text:         (a) => `Speaking: ${_truncate(a.text || '', 30)}`,

    // NPM / JS
    execute_npm_function: (a) => `Running npm: ${_truncate(a.package_name || '', 30)}`,
    execute_javascript:   () => `Executing JavaScript code`,

    // OpenClaw
    delegate_to_openclaw: (a) => `Delegating to OpenClaw: ${_truncate(a.task || '', 40)}`,

    // Desktop
    mouse_click:    () => `Clicking on screen`,
    keyboard_type:  (a) => `Typing text`,
    screen_capture: () => `Capturing screen`,

    // Skills
    use_skill:  (a) => `Using skill: ${a.name || ''}`,
    list_skills: () => `Listing available skills`,

    // MCP
    mcp_list_servers: () => `Listing MCP servers`,

    // Chrome
    chrome_navigate:  (a) => `Navigating Chrome to ${_truncate(a.url || '', 50)}`,
    chrome_click:     (a) => `Clicking element: ${_truncate(a.selector || '', 40)}`,
    chrome_type:      (a) => `Typing in Chrome: ${_truncate(a.selector || '', 40)}`,
    chrome_screenshot:() => `Taking Chrome screenshot`,
    chrome_evaluate:  () => `Evaluating JavaScript in Chrome`,
};

/**
 * Emit a human-readable status description for the given tool call.
 * @param {string} toolName
 * @param {Object} args — parsed tool arguments
 */
export function emitToolStatus(toolName, args) {
    consoleStyler.log('status', _resolveToolDescription(toolName, args));
}

/**
 * Emit a lifecycle status message.
 * @param {string} message — human-readable description
 */
export function emitStatus(message) {
    consoleStyler.log('status', message);
}

/**
 * Create a short summary of user input for inclusion in status messages.
 * Truncates to ~60 chars, removes newlines, wraps in quotes.
 *
 * NOTE: This embeds raw user text into status lines that are broadcast to
 * all connected WebSocket clients.  In the current single-user architecture
 * this is acceptable, but if multi-user or shared logging is added in the
 * future, consider sanitizing or omitting user input from status messages.
 *
 * @param {string} input
 * @returns {string} — e.g. '"read through our conversation and…"'
 */
export function summarizeInput(input) {
    if (!input) return '';
    const str = typeof input === 'string' ? input : JSON.stringify(input);
    const clean = str.replace(/[\r\n]+/g, ' ').trim();
    if (clean.length <= 60) return `"${clean}"`;
    return `"${clean.substring(0, 57)}…"`;
}

/**
 * Produce a descriptive narration for a tool call including key arguments.
 * More verbose than emitToolStatus — designed for the activity log narration.
 * @param {string} toolName
 * @param {Object} args
 * @returns {string}
 */
export function describeToolCall(toolName, args) {
    const base = _resolveToolDescription(toolName, args);

    // Append key argument details for common tools when not already in base.
    // Coerce to string defensively — tool schemas may supply non-string values.
    const details = [];
    if (args) {
        const queryStr = typeof args.query === 'string' ? args.query : '';
        if (queryStr && !base.includes(queryStr.substring(0, 10))) {
            details.push(`query: "${_truncate(queryStr, 40)}"`);
        }
        if (args.limit != null) details.push(`limit: ${args.limit}`);
        if (args.path && !base.includes(args.path)) details.push(`path: ${_short(args.path)}`);
        const cmdStr = typeof args.command === 'string' ? args.command : '';
        if (cmdStr && !base.includes(cmdStr.substring(0, 10))) {
            details.push(`cmd: "${_truncate(cmdStr, 40)}"`);
        }
    }

    return details.length > 0 ? `${base} (${details.join(', ')})` : base;
}

// ── Helpers ────────────────────────────────────────────

/**
 * Resolve a tool name + args to a human-readable description string.
 * Shared by emitToolStatus() and describeToolCall() to avoid duplicated
 * fallback logic for TOOL_STATUS_MAP lookups, MCP prefix handling, etc.
 * @param {string} toolName
 * @param {Object} args
 * @returns {string}
 */
function _resolveToolDescription(toolName, args) {
    const generator = TOOL_STATUS_MAP[toolName];
    if (generator) {
        try { return generator(args || {}); } catch { /* fall through */ }
    }
    if (toolName.startsWith('mcp_')) {
        const parts = toolName.replace(/^mcp_/, '').split('_');
        return `Using MCP tool: ${parts.slice(1).join('_')} (${parts[0]})`;
    }
    return `Running ${_humanize(toolName)}`;
}

/** Shorten a file path to its last 2 segments. */
function _short(p) {
    if (!p) return '(unknown)';
    const parts = p.replace(/\\/g, '/').split('/');
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}

/** Truncate a string to maxLen characters. */
function _truncate(s, maxLen = 50) {
    if (!s) return '';
    return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
}

/** Convert snake_case tool names to Title Case. */
function _humanize(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

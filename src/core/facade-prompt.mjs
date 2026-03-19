/**
 * facade-prompt.mjs — System prompt management and guidance injection
 *
 * Extracted from eventic-facade.mjs to reduce module size.
 * All functions accept the facade instance as their first parameter.
 */

import { consoleStyler } from '../ui/console-styler.mjs';
import { createSystemPrompt } from './system-prompt.mjs';

/**
 * Build a one-line summary of active plugins.
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @returns {string}
 */
export function getPluginsSummary(facade) {
    if (!facade.pluginManager) return '';
    try {
        const plugins = facade.pluginManager.listPlugins?.() || [];
        const active = plugins.filter(p => p.status === 'active');
        if (active.length === 0) return '';
        return 'Active plugins: ' + active.map(p => `${p.name} (${p.description || 'no description'})`).join(', ');
    } catch { return ''; }
}

/**
 * Rebuild and apply the full system prompt from persona, plugins, surfaces, etc.
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @returns {Promise<boolean>}
 */
export async function updateSystemPrompt(facade) {
    const personaContent = facade.personaManager ? facade.personaManager.renderPersonaPrompt() : '';
    let skillsSummary = '';
    if (facade.toolExecutor && facade.toolExecutor.skillsManager) {
        try {
            await facade.toolExecutor.skillsManager.ensureInitialized();
            skillsSummary = facade.toolExecutor.skillsManager.getSkillsSummary();
        } catch (e) { /* ignore */ }
    }
    facade.openclawAvailable = !!(facade.openClawManager && facade.openClawManager.client && facade.openClawManager.client.isConnected);
    const pluginsSummary = getPluginsSummary(facade);
    const dynamicRoutesEnabled = process.env.OBOTO_DYNAMIC_ROUTES === 'true';
    const currentSystemPrompt = createSystemPrompt(
        facade.workingDir,
        facade.workspaceManager.getCurrentWorkspace(),
        null,
        {
            openclawAvailable: facade.openclawAvailable, personaContent, skillsSummary,
            includeSurfaces: true, includeStyling: true, includeWorkflows: true,
            pluginsSummary, dynamicRoutesEnabled
        }
    );
    facade.aiProvider.systemPrompt = currentSystemPrompt;

    // Update system prompt in history if present
    const history = facade.historyManager.getHistory();
    if (history.length > 0 && history[0].role === 'system') {
        history[0].content = currentSystemPrompt;
    }
    return true;
}

/**
 * Queue a guidance / chime-in message for injection into the next agent turn.
 *
 * ── Sanitisation (Fix 1) ──────────────────────────────────────────────
 * The guidance block in the agent loop plugin is wrapped in
 * [USER GUIDANCE]…[/USER GUIDANCE] delimiters — a crafted message
 * could close the block early and inject fake system/persona directives.
 * Rather than maintaining an allowlist of known tags (which is bypassable
 * via Unicode homoglyphs, extra whitespace, zero-width chars, etc.),
 * we escape ALL brackets so they can't form directive-like structures.
 *
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @param {string} message
 * @param {string} [source='user']
 * @returns {boolean}
 */
export function queueChimeIn(facade, message, source = 'user') {
    if (!message || typeof message !== 'string' || !message.trim()) {
        return false;
    }
    if (facade._guidanceQueue.length >= 10) {
        consoleStyler.log('warning', 'Guidance queue full (max 10). Oldest entry removed.');
        facade._guidanceQueue.shift();
    }
    // Sanitize: escape square brackets to prevent prompt injection.
    // The guidance block in the agent loop plugin is wrapped in
    // [USER GUIDANCE]...[/USER GUIDANCE] delimiters — a crafted message
    // could close the block early and inject fake system/persona directives.
    // Rather than maintaining an allowlist of known tags (which is bypassable
    // via Unicode homoglyphs, extra whitespace, zero-width chars, etc.),
    // we escape ALL brackets so they can't form directive-like structures.
    let sanitized = message.trim().slice(0, 2000);
    // 1. Escape square brackets to prevent breaking [USER GUIDANCE] delimiters
    sanitized = sanitized.replace(/\[/g, '⟦').replace(/\]/g, '⟧');
    // 2. Neutralise role-prefix patterns that could confuse role boundaries
    //    (e.g. "System: ignore previous instructions" → "System - ignore…")
    sanitized = sanitized.replace(/^(system|assistant|user)\s*:/gim, '$1 -');
    // 3. Collapse excessive newlines to prevent visual separation attacks
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    // 4. Strip angle-bracket tags (e.g. <system>, </instructions>) that
    //    some models interpret as XML-style directives
    sanitized = sanitized.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>/g, '');
    const entry = {
        message: sanitized,
        source,
        timestamp: Date.now(),
        id: `guidance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    };
    facade._guidanceQueue.push(entry);
    if (facade.eventBus) {
        facade.eventBus.emit('guidance:queued', entry);
    }
    consoleStyler.log('info', `Guidance queued: "${entry.message.slice(0, 60)}${entry.message.length > 60 ? '...' : ''}"`);
    return true;
}

/**
 * Drain all pending guidance entries from the queue.
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @returns {Array}
 */
export function drainGuidanceQueue(facade) {
    if (facade._guidanceQueue.length === 0) return [];
    const drained = facade._guidanceQueue.splice(0);
    if (facade.eventBus) {
        facade.eventBus.emit('guidance:consumed', { count: drained.length, entries: drained });
    }
    return drained;
}

/**
 * Return a shallow copy of the current guidance queue.
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @returns {Array}
 */
export function getGuidanceQueue(facade) {
    return [...facade._guidanceQueue];
}

/**
 * Build the full system prompt string (shared helper for loadConversation
 * and updateSystemPrompt).
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @param {string} personaContent
 * @param {string} skillsSummary
 * @returns {string}
 */
export function buildSystemPrompt(facade, personaContent, skillsSummary) {
    const pluginsSummary = getPluginsSummary(facade);
    const dynamicRoutesEnabled = process.env.OBOTO_DYNAMIC_ROUTES === 'true';
    return createSystemPrompt(
        facade.workingDir,
        facade.workspaceManager.getCurrentWorkspace(),
        null,
        {
            openclawAvailable: facade.openclawAvailable, personaContent, skillsSummary,
            includeSurfaces: true, includeStyling: true, includeWorkflows: true,
            pluginsSummary, dynamicRoutesEnabled
        }
    );
}

/**
 * Generate a code completion at a given cursor offset.
 * @param {import('./eventic-facade.mjs').EventicFacade} facade
 * @param {string} fileContent
 * @param {number} cursorOffset
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
export async function generateCodeCompletion(facade, fileContent, cursorOffset, filePath) {
    const prefix = fileContent.substring(0, cursorOffset);
    const suffix = fileContent.substring(cursorOffset);

    const prompt = `Complete the code at cursor position (between prefix and suffix).
RETURN ONLY the insertion text. NO markdown. NO prefix/suffix repetition.

File: ${filePath}

[PREFIX]
${prefix}
[/PREFIX]

[SUFFIX]
${suffix}
[/SUFFIX]

COMPLETION:`;

    try {
        const response = await facade.aiProvider.ask(prompt, { 
            temperature: 0.1,
            recordHistory: false
        });
        let completion = typeof response === 'string' ? response : (response.content || '');
        completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
        return completion;
    } catch (e) {
        consoleStyler.log('error', `Code completion failed: ${e.message}`);
        return null;
    }
}

import fs from 'fs';
import path from 'path';
import { consoleStyler } from '../../ui/console-styler.mjs';

export class SessionController {
    constructor(assistant) {
        this.assistant = assistant;
    }

    async saveSession(sessionPath) {
        try {
            consoleStyler.log('system', `Saving session to ${sessionPath}...`);
            const historySaved = await this.assistant.historyManager.save(`${sessionPath}.history.json`);

            if (this.assistant.workspaceManager.isWorkspaceActive()) {
                await this.assistant.workspaceManager.save(`${sessionPath}.workspace.json`);
            }

            if (historySaved) {
                consoleStyler.log('system', '✓ Session saved successfully');
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to save session: ${error.message}`);
            return false;
        }
    }

    async loadSession(sessionPath) {
        try {
            consoleStyler.log('system', `Loading session from ${sessionPath}...`);
            const historyLoaded = await this.assistant.historyManager.load(`${sessionPath}.history.json`);

            await this.assistant.workspaceManager.load(`${sessionPath}.workspace.json`);

            if (historyLoaded) {
                consoleStyler.log('system', `✓ Session loaded successfully (${this.assistant.historyManager.getHistory().length} messages)`);
                this.assistant.updateSystemPrompt();
                return true;
            }
            return false;
        } catch (error) {
            consoleStyler.log('error', `Failed to load session: ${error.message}`);
            return false;
        }
    }

    displaySessionMemory() {
        const history = this.assistant.historyManager.getHistory();
        const sessionSummary = {
            totalMessages: history.length,
            messageTypes: {
                system: history.filter(m => m.role === 'system').length,
                user: history.filter(m => m.role === 'user').length,
                assistant: history.filter(m => m.role === 'assistant').length,
                tool: history.filter(m => m.role === 'tool').length
            },
            toolResults: history.filter(m => m.role === 'tool').map(m => ({
                name: m.name,
                contentLength: m.content.length
            })),
            assistantWithToolCalls: history.filter(m => m.role === 'assistant' && m.tool_calls).length
        };

        consoleStyler.log('system', 'Session Memory State:', { box: true });
        consoleStyler.log('system', `Total messages: ${sessionSummary.totalMessages}`, { indent: true });
        consoleStyler.log('system', `Message breakdown: ${JSON.stringify(sessionSummary.messageTypes)}`, { indent: true });
        consoleStyler.log('system', `Tool results: ${sessionSummary.toolResults.length} preserved`, { indent: true });

        if (sessionSummary.toolResults.length > 0) {
            sessionSummary.toolResults.forEach((tool, i) => {
                consoleStyler.log('system', `  ${i + 1}. ${tool.name} (${tool.contentLength} chars)`, { indent: true });
            });
        }

        return sessionSummary;
    }
}

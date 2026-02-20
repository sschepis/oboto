import { createSystemPrompt } from '../system-prompt.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { TASK_ROLES } from '../prompt-router.mjs';

export class ConversationController {
    constructor(assistant) {
        this.assistant = assistant;
        this.manager = assistant.conversationManager;
        this.eventBus = assistant.eventBus;
    }

    async listConversations() {
        return await this.manager.listConversations();
    }

    async createConversation(name) {
        const personaContent = this.assistant.personaManager ? this.assistant.personaManager.renderPersonaPrompt() : '';
        const openclawAvailable = !!(this.assistant.openClawManager && this.assistant.openClawManager.client && this.assistant.openClawManager.client.isConnected);
        
        const systemPrompt = createSystemPrompt(
            this.assistant.workingDir,
            this.assistant.workspaceManager.getCurrentWorkspace(),
            null,
            { openclawAvailable, personaContent }
        );

        const result = await this.manager.createConversation(name, systemPrompt);

        if (result.created && this.eventBus) {
            const conversations = await this.manager.listConversations();
            this.eventBus.emit('server:conversation-list', conversations);
        }

        return result;
    }

    async switchConversation(name) {
        const result = await this.manager.switchConversation(name);

        if (result.switched) {
            this.assistant.historyManager = this.manager.getActiveHistoryManager();
            this.assistant._refreshServices(); // Sync services with new history manager
            await this.assistant.updateSystemPrompt();

            await this.assistant.symbolicContinuity.initialize(
                this.manager.getActiveConversationName()
            );

            if (this.eventBus) {
                this.eventBus.emit('server:history-loaded', this.assistant.historyManager.getHistory());
                this.eventBus.emit('server:conversation-switched', {
                    name: this.manager.getActiveConversationName(),
                    isDefault: this.manager.isDefaultConversation()
                });
            }
        }

        return result;
    }

    async deleteConversation(name) {
        const result = await this.manager.deleteConversation(name);

        if (result.deleted) {
            this.assistant.historyManager = this.manager.getActiveHistoryManager();
            this.assistant._refreshServices();

            if (this.eventBus) {
                const conversations = await this.manager.listConversations();
                this.eventBus.emit('server:conversation-list', conversations);
                this.eventBus.emit('server:history-loaded', this.assistant.historyManager.getHistory());
                this.eventBus.emit('server:conversation-switched', {
                    name: this.manager.getActiveConversationName(),
                    isDefault: this.manager.isDefaultConversation()
                });
            }
        }

        return result;
    }

    async renameConversation(oldName, newName) {
        const result = await this.manager.renameConversation(oldName, newName);

        if (result.success) {
            // If active conversation was renamed, update references
            if (this.manager.getActiveConversationName() === result.newName) {
                 this.assistant.historyManager = this.manager.getActiveHistoryManager();
                 this.assistant._refreshServices();
            }

            if (this.eventBus) {
                const conversations = await this.manager.listConversations();
                this.eventBus.emit('server:conversation-list', conversations);
                this.eventBus.emit('server:conversation-renamed', {
                    oldName: result.oldName,
                    newName: result.newName
                });
            }
        }

        return result;
    }

    async reportToParent(summary, metadata = {}) {
        const childName = this.manager.getActiveConversationName();
        return await this.manager.reportToParent(childName, summary, metadata);
    }

    getActiveConversationName() {
        return this.manager.getActiveConversationName();
    }
}

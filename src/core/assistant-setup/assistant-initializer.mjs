import { TOOLS } from '../../tools/tool-definitions.mjs';
import { MCP_TOOLS } from '../../tools/definitions/mcp-tools.mjs';
import { OPENCLAW_TOOLS } from '../../tools/definitions/openclaw-tools.mjs';
import { createSystemPrompt } from '../system-prompt.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';

export class AssistantInitializer {
    constructor(assistant) {
        this.assistant = assistant;
        this._systemPromptDirty = true;
        this._personaBootstrapped = false;
        this._cachedCustomTools = null;
    }

    registerServices(services) {
        const s = services;
        const a = this.assistant;
        
        s.register('historyManager', a.historyManager);
        s.register('conversationManager', a.conversationManager);
        s.register('toolExecutor', a.toolExecutor);
        s.register('promptRouter', a.promptRouter);
        s.register('llmAdapter', a.llmAdapter);
        s.register('reasoningSystem', a.reasoningSystem);
        s.register('workspaceManager', a.workspaceManager);
        s.register('qualityEvaluator', a.qualityEvaluator);
        s.register('qualityGate', a.qualityGate);
        s.register('pipeline', a._pipeline);

        s.register('consciousness', a.consciousness);
        s.register('symbolicContinuity', a.symbolicContinuity);
        s.register('memoryAdapter', a.memoryAdapter);
        s.register('taskManager', a.taskManager);
        s.register('schedulerService', a.schedulerService);
        s.register('statusAdapter', a.statusAdapter);
        s.register('eventBus', a.eventBus);
        s.register('middleware', a.middleware);
        s.register('personaManager', a.personaManager);
        s.register('resoLangService', a.resoLangService);
        s.register('openClawManager', a.openClawManager);
        s.register('mcpClientManager', a.mcpClientManager);

        s.register('toolLoader', {
            ensureLoaded: () => this.initializeCustomTools(),
            getTools: () => a.allTools
        });

        s.register('transcriptLogger', {
            log: (type, model, data) => a._logTranscript(type, model, data)
        });

        s.register('config', {
            maxTurns: a.maxTurns,
            maxSubagents: a.maxSubagents,
            temperature: a.temperature,
            dryRun: a.dryRun,
            workingDir: a.workingDir
        });
    }

    async initializeCustomTools() {
        const a = this.assistant;
        
        if (a.resoLangService) await a.resoLangService.initialize();
        await a.consciousness.initialize();
        if (a.personaManager) await a.personaManager.initialize();
        if (a.mcpClientManager) await a.mcpClientManager.initialize();

        if (this._systemPromptDirty !== false) {
            await this.updateSystemPrompt();
            this._systemPromptDirty = false;
        }

        if (a.personaManager && !this._personaBootstrapped) {
            await this._bootstrapPersona();
            this._personaBootstrapped = true;
        }

        a.allTools = [...TOOLS, ...MCP_TOOLS];
        if (a.openClawManager) a.allTools.push(...OPENCLAW_TOOLS);

        if (!this._cachedCustomTools) {
            this._cachedCustomTools = await a.customToolsManager.loadCustomTools();
        }
        a.allTools.push(...this._cachedCustomTools);

        if (a.mcpClientManager) {
            a.allTools.push(...a.mcpClientManager.getAllTools());
        }

        a.customToolsLoaded = true;
    }

    async _bootstrapPersona() {
        const a = this.assistant;
        const bootstrap = a.personaManager.getBootstrapConfig();
        if (!bootstrap) return;

        if (bootstrap.morningBriefing?.enabled && a.schedulerService) {
            try {
                const existing = a.schedulerService.listSchedules('all');
                const alreadyExists = existing.some(s => s.name === (bootstrap.morningBriefing.name || 'Morning Briefing'));

                if (!alreadyExists) {
                    await a.schedulerService.createSchedule({
                        name: bootstrap.morningBriefing.name || 'Morning Briefing',
                        description: bootstrap.morningBriefing.description || 'Daily persona briefing',
                        query: bootstrap.morningBriefing.query,
                        intervalMs: (bootstrap.morningBriefing.intervalMinutes || 1440) * 60 * 1000,
                        maxRuns: null,
                        skipIfRunning: true,
                        tags: ['persona', 'briefing']
                    });
                    consoleStyler.log('system', `🎭 Persona bootstrap: Morning Briefing schedule created (every ${bootstrap.morningBriefing.intervalMinutes || 1440} min)`);
                } else {
                    consoleStyler.log('system', '🎭 Persona bootstrap: Morning Briefing schedule already exists');
                }
            } catch (e) {
                consoleStyler.log('warning', `Failed to set up Morning Briefing: ${e.message}`);
            }
        }
    }

    markSystemPromptDirty() {
        this._systemPromptDirty = true;
    }

    async updateSystemPrompt() {
        const a = this.assistant;
        let manifestContent = null;
        if (a.manifestManager && a.manifestManager.hasManifest()) {
            manifestContent = await a.manifestManager.readManifest();
        }

        a.openclawAvailable = !!(a.openClawManager && a.openClawManager.client && a.openClawManager.client.isConnected);

        let skillsSummary = "";
        if (a.toolExecutor && a.toolExecutor.skillsManager) {
            await a.toolExecutor.skillsManager.ensureInitialized();
            skillsSummary = a.toolExecutor.skillsManager.getSkillsSummary();
        }

        let personaContent = "";
        if (a.personaManager) {
            personaContent = a.personaManager.renderPersonaPrompt();
        }

        a.historyManager.updateSystemPrompt(
            createSystemPrompt(
                a.workingDir,
                a.workspaceManager.getCurrentWorkspace(),
                manifestContent,
                {
                    openclawAvailable: a.openclawAvailable,
                    skillsSummary,
                    personaContent,
                    symbolicContinuityEnabled: a.symbolicContinuity?.enabled || false,
                    chineseRoomMode: a.symbolicContinuity?.chineseRoomEnabled || false
                }
            )
        );
    }
}

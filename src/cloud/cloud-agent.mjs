// CloudAgent — Cloud AI agent invocation via Edge Functions
// Handles listing and invoking cloud agents through the agent-chat endpoint.

/**
 * Manages cloud AI agent interactions. Cloud agents are persistent AI
 * entities configured in the Oboto Cloud dashboard with custom personas,
 * system prompts, and model configs. They are invoked by slug name.
 */
export class CloudAgent {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     */
    constructor(client, eventBus) {
        this.client = client;
        this.eventBus = eventBus;

        /** @type {Array|null} Cached agent list */
        this._cachedAgents = null;
        this._cacheExpiry = 0;
    }

    /**
     * List available cloud agents for an organization.
     * Results are cached for 60 seconds.
     * @param {string} orgId
     * @returns {Promise<Array<{ id: string, name: string, slug: string, agent_type: string, description: string|null, status: string, avatar_url: string|null }>>}
     */
    async listAgents(orgId) {
        // Return cache if fresh
        if (this._cachedAgents && Date.now() < this._cacheExpiry) {
            return this._cachedAgents;
        }

        const agents = await this.client.get(
            `/rest/v1/cloud_agents?org_id=eq.${orgId}&select=id,name,slug,agent_type,description,status,avatar_url&order=name.asc`
        );

        this._cachedAgents = agents || [];
        this._cacheExpiry = Date.now() + 60000; // 60s cache

        return this._cachedAgents;
    }

    /**
     * Invoke a cloud agent with a message.
     * Calls the agent-chat Edge Function which handles persona loading,
     * AI provider routing, and response persistence.
     *
     * @param {string} agentSlug — Agent identifier (e.g. "code-reviewer")
     * @param {string} conversationId — Cloud conversation UUID (can be null for standalone invocation)
     * @param {string} message — User message to send to the agent
     * @param {Array<{ role: string, content: string }>} messageHistory — Recent messages for context
     * @returns {Promise<{ content: string, messageId: string, agentName: string }>}
     * @throws {Error} On invocation failure (rate limit, agent not found, AI error)
     */
    async invoke(agentSlug, conversationId, message, messageHistory = []) {
        const result = await this.client.post('/functions/v1/agent-chat', {
            agentSlug,
            conversationId,
            userMessage: message,
            messageHistory: messageHistory.slice(-20), // Last 20 messages for context
        });

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:agent:invoked', {
                slug: agentSlug,
                agentName: result.agentName,
                messageId: result.messageId,
            });
        }

        return result;
    }

    /**
     * Clear the cached agent list (e.g. after creating/deleting an agent).
     */
    clearCache() {
        this._cachedAgents = null;
        this._cacheExpiry = 0;
    }
}

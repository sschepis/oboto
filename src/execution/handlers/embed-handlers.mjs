/**
 * Handles the embed_object tool call.
 * 
 * This handler emits an 'embed:created' event via the EventBus so the
 * web server can broadcast an 'embed' message to the UI, which renders
 * the embedded content inline in the chat.
 * 
 * The tool returns a text summary to the LLM confirming what was embedded.
 */
export class EmbedHandlers {
    constructor(eventBus) {
        this.eventBus = eventBus;
    }

    async embedObject(args) {
        const {
            embed_type,
            url,
            title,
            description,
            thumbnail_url,
            start_time,
            autoplay = false,
            width,
            height,
        } = args;

        // Validate required fields
        if (!embed_type || !url) {
            return 'Error: embed_type and url are required.';
        }

        const validTypes = ['youtube', 'video', 'audio', 'iframe', 'map', 'tweet', 'codepen', 'spotify', 'figma', 'gist', 'loom', 'generic'];
        if (!validTypes.includes(embed_type)) {
            return `Error: Invalid embed_type '${embed_type}'. Valid types: ${validTypes.join(', ')}`;
        }

        // Build the embed data payload matching the UI's EmbeddedObject interface
        const embedData = {
            embedType: embed_type,
            url,
            title: title || undefined,
            description: description || undefined,
            thumbnailUrl: thumbnail_url || undefined,
            startTime: start_time || undefined,
            autoplay: autoplay || false,
            width: width || '100%',
            height: height || undefined,
        };

        // Emit event so the web-server can broadcast it as a chat message
        if (this.eventBus) {
            this.eventBus.emit('embed:created', {
                id: `embed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                role: 'ai',
                type: 'embed',
                embed: embedData,
                content: `[Embedded ${embed_type}: ${title || url}]`,
                timestamp: new Date().toLocaleTimeString(),
            });
        }

        // Return confirmation text to the LLM
        const label = title ? `"${title}"` : url;
        return `Successfully embedded ${embed_type} content: ${label}. The user can now see it inline in the chat.`;
    }
}

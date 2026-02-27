/**
 * CloudLoader — lazy-initializer for CloudSync.
 *
 * Wraps the mutable CloudSync reference so that it can be lazily
 * initialized when cloud secrets (OBOTO_CLOUD_URL, OBOTO_CLOUD_KEY)
 * become available after startup.
 *
 * @module src/server/cloud-loader
 */

import { consoleStyler } from '../ui/console-styler.mjs';

export class CloudLoader {
    /**
     * @param {import('../lib/event-bus.mjs').EventBus} eventBus
     * @param {object} secretsManager
     * @param {string} workingDir
     * @param {object} assistant
     * @param {object|null} cloudSync — pre-existing CloudSync instance (if any)
     */
    constructor(eventBus, secretsManager, workingDir, assistant, cloudSync) {
        this.eventBus = eventBus;
        this.secretsManager = secretsManager;
        this.workingDir = workingDir;
        this.assistant = assistant;

        /** The active CloudSync instance, or null if not yet initialized. */
        this.instance = cloudSync || null;

        // Bind so callers can pass `cloudLoader.initCloudSync` as a standalone function
        this.initCloudSync = this.initCloudSync.bind(this);
    }

    /**
     * Lazy-initialize CloudSync when cloud secrets become available after startup.
     * Called by the secrets handler when OBOTO_CLOUD_URL or OBOTO_CLOUD_KEY are set.
     *
     * @returns {Promise<object|null>} The CloudSync instance, or null if secrets aren't complete.
     */
    async initCloudSync() {
        // Already initialized
        if (this.instance) return this.instance;

        const url = process.env.OBOTO_CLOUD_URL;
        const key = process.env.OBOTO_CLOUD_KEY;
        if (!url || !key) return null;

        try {
            const { CloudSync } = await import('../cloud/cloud-sync.mjs');
            const { loadCloudConfig } = await import('../cloud/cloud-config.mjs');
            const cloudConfig = loadCloudConfig();
            if (!cloudConfig) return null;

            const newCloudSync = new CloudSync(this.eventBus, this.secretsManager);
            await newCloudSync.initialize(cloudConfig);
            newCloudSync.setWorkingDir(this.workingDir);

            // Register in assistant's service registry
            if (this.assistant._services) {
                this.assistant._services.register('cloudSync', newCloudSync);
            }

            // Set up AI provider cloud reference
            try {
                const { setCloudSyncRef, setEventBusRef } = await import('../core/ai-provider.mjs');
                setCloudSyncRef(newCloudSync);
                setEventBusRef(this.eventBus);
            } catch (e) {
                // ai-provider refs are optional
            }

            // Auto-login from cached refresh token (silent, non-blocking)
            newCloudSync.tryAutoLogin().catch(err => {
                consoleStyler.log('warning', `Cloud auto-login failed: ${err.message}`);
            });

            this.instance = newCloudSync;
            consoleStyler.log('cloud', 'Cloud initialized from secrets vault');

            return newCloudSync;
        } catch (err) {
            consoleStyler.log('warning', `Failed to initialize cloud from secrets: ${err.message}`);
            return null;
        }
    }
}

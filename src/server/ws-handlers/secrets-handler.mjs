import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';

/**
 * Handles: get-secrets, set-secret, delete-secret
 */

async function handleGetSecrets(data, ctx) {
    const { ws, secretsManager } = ctx;
    if (secretsManager) {
        const secrets = secretsManager.list();
        wsSend(ws, 'secrets-list', { secrets, categories: secretsManager.getCategories() });
    } else {
        wsSend(ws, 'secrets-list', { secrets: [], categories: [] });
    }
}

async function handleSetSecret(data, ctx) {
    const { ws, secretsManager, broadcast } = ctx;
    if (secretsManager) {
        try {
            const { name, value, category, description } = data.payload;
            await secretsManager.set(name, value, category, description);
            wsSend(ws, 'secret-set', { name, success: true });

            if ((name === 'OBOTO_CLOUD_URL' || name === 'OBOTO_CLOUD_KEY') && ctx.initCloudSync) {
                const cloudSync = await ctx.initCloudSync();
                if (cloudSync) {
                    broadcast('cloud:status', cloudSync.getStatus());
                }
            }
        } catch (err) {
            consoleStyler.log('error', `Failed to set secret: ${err.message}`);
            wsSendError(ws, `Failed to set secret: ${err.message}`);
        }
    } else {
        wsSendError(ws, 'Secrets manager not available');
    }
}

async function handleDeleteSecret(data, ctx) {
    const { ws, secretsManager } = ctx;
    if (secretsManager) {
        try {
            const { name } = data.payload;
            const deleted = await secretsManager.delete(name);
            wsSend(ws, 'secret-deleted', {
                name,
                success: deleted,
                reason: deleted ? undefined : 'Secret not found in vault'
            });
        } catch (err) {
            consoleStyler.log('error', `Failed to delete secret: ${err.message}`);
            wsSendError(ws, `Failed to delete secret: ${err.message}`);
        }
    } else {
        wsSendError(ws, 'Secrets manager not available');
    }
}

export const handlers = {
    'get-secrets': handleGetSecrets,
    'set-secret': handleSetSecret,
    'delete-secret': handleDeleteSecret
};

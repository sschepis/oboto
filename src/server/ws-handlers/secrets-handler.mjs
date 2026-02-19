import { consoleStyler } from '../../ui/console-styler.mjs';

/**
 * Handles: get-secrets, set-secret, delete-secret
 */

async function handleGetSecrets(data, ctx) {
    const { ws, secretsManager } = ctx;
    if (secretsManager) {
        const secrets = secretsManager.list();
        ws.send(JSON.stringify({
            type: 'secrets-list',
            payload: {
                secrets,
                categories: secretsManager.getCategories()
            }
        }));
    } else {
        // Send an empty secrets-list so the UI exits the loading state
        ws.send(JSON.stringify({
            type: 'secrets-list',
            payload: { secrets: [], categories: [] }
        }));
    }
}

async function handleSetSecret(data, ctx) {
    const { ws, secretsManager } = ctx;
    if (secretsManager) {
        try {
            const { name, value, category, description } = data.payload;
            await secretsManager.set(name, value, category, description);
            ws.send(JSON.stringify({
                type: 'secret-set',
                payload: { name, success: true }
            }));
        } catch (err) {
            consoleStyler.log('error', `Failed to set secret: ${err.message}`);
            ws.send(JSON.stringify({
                type: 'error',
                payload: `Failed to set secret: ${err.message}`
            }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Secrets manager not available' }));
    }
}

async function handleDeleteSecret(data, ctx) {
    const { ws, secretsManager } = ctx;
    if (secretsManager) {
        try {
            const { name } = data.payload;
            const deleted = await secretsManager.delete(name);
            ws.send(JSON.stringify({
                type: 'secret-deleted',
                payload: {
                    name,
                    success: deleted,
                    reason: deleted ? undefined : 'Secret not found in vault'
                }
            }));
        } catch (err) {
            consoleStyler.log('error', `Failed to delete secret: ${err.message}`);
            ws.send(JSON.stringify({
                type: 'error',
                payload: `Failed to delete secret: ${err.message}`
            }));
        }
    } else {
        ws.send(JSON.stringify({ type: 'error', payload: 'Secrets manager not available' }));
    }
}

export const handlers = {
    'get-secrets': handleGetSecrets,
    'set-secret': handleSetSecret,
    'delete-secret': handleDeleteSecret
};

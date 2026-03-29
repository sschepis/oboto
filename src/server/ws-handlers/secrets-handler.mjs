import path from 'path';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';
import { upsertEnvFile } from '../../lib/env-file-utils.mjs';

/**
 * Handles: get-secrets, set-secret, delete-secret, submit-secret, cancel-secret
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

/**
 * Handle a secret submission from the UI in response to a `request_secret` tool call.
 * 
 * This handler:
 * 1. Writes the secret to the workspace `.env` file
 * 2. Stores it in the encrypted global vault (SecretsManager)
 * 3. Updates `process.env` so it's immediately available
 * 4. Resolves the pending AI tool request via SecretHandlers
 * 
 * The secret value NEVER enters the AI's conversation context.
 */
async function handleSubmitSecret(data, ctx) {
    const { ws, secretsManager, assistant, eventBus } = ctx;
    const { requestId, name, value } = data.payload || {};

    if (!requestId || !name || !value) {
        wsSendError(ws, 'submit-secret: requestId, name, and value are required');
        return;
    }

    try {
        // 1. Write to workspace .env file
        const workspaceRoot = assistant?.workingDir || process.cwd();
        const envPath = path.join(workspaceRoot, '.env');
        upsertEnvFile(envPath, name, value);
        consoleStyler.log('system', `🔐 Secret '${name}' written to ${envPath}`);

        // 2. Store in encrypted vault (if available)
        if (secretsManager) {
            try {
                await secretsManager.set(name, value, 'workspace', `Auto-stored from request_secret tool`);
            } catch (vaultErr) {
                consoleStyler.log('warning', `🔐 Vault storage failed for '${name}': ${vaultErr.message} (env file was updated successfully)`);
            }
        }

        // 3. Update process.env immediately
        process.env[name] = value;

        // 4. Resolve the pending AI tool request
        const toolExecutor = assistant?.toolExecutor;
        if (toolExecutor?.secretHandlers) {
            toolExecutor.secretHandlers.resolveSecretRequest(requestId, true);
        } else if (eventBus) {
            // Fallback: emit on eventBus in case secretHandlers isn't directly accessible
            eventBus.emit('secret:provided', { requestId, name, success: true });
        }

        wsSend(ws, 'secret-submitted', { requestId, name, success: true });
    } catch (err) {
        consoleStyler.log('error', `Failed to store secret '${name}': ${err.message}`);
        wsSendError(ws, `Failed to store secret: ${err.message}`);
    }
}

/**
 * Handle a secret cancellation from the UI.
 * The user chose not to provide the requested secret.
 */
async function handleCancelSecret(data, ctx) {
    const { ws, assistant, eventBus } = ctx;
    const { requestId, name } = data.payload || {};

    if (!requestId) {
        wsSendError(ws, 'cancel-secret: requestId is required');
        return;
    }

    consoleStyler.log('system', `🔐 Secret request cancelled by user: ${name || requestId}`);

    // Resolve the pending AI tool request with success=false (cancelled)
    const toolExecutor = assistant?.toolExecutor;
    if (toolExecutor?.secretHandlers) {
        toolExecutor.secretHandlers.resolveSecretRequest(requestId, false);
    } else if (eventBus) {
        eventBus.emit('secret:provided', { requestId, name, success: false });
    }

    wsSend(ws, 'secret-cancelled', { requestId, name });
}

export const handlers = {
    'get-secrets': handleGetSecrets,
    'set-secret': handleSetSecret,
    'delete-secret': handleDeleteSecret,
    'submit-secret': handleSubmitSecret,
    'cancel-secret': handleCancelSecret
};

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wsSend } from '../../lib/ws-utils.mjs';
import { readJsonFileSync } from '../../lib/json-file-utils.mjs';

const SETUP_FILE = '.ai-man/setup.json';

async function handleGetSetupStatus(data, ctx) {
    const { ws } = ctx;
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const filePath = path.join(projectRoot, SETUP_FILE);
    
    const setupData = readJsonFileSync(filePath, null);
    const isFirstRun = setupData === null;
    
    wsSend(ws, 'setup-status', { isFirstRun, ...(setupData || {}) });
}

async function handleCompleteSetup(data, ctx) {
    const { ws } = ctx;
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const dirPath = path.join(projectRoot, '.ai-man');
    const filePath = path.join(dirPath, 'setup.json');
    
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        
        const setupData = {
            version: 1,
            completedAt: new Date().toISOString(),
            ...data.payload
        };
        
        await fs.promises.writeFile(filePath, JSON.stringify(setupData, null, 2));
        wsSend(ws, 'setup-complete', { success: true });
    } catch (err) {
        console.error('[SetupHandler] Failed to save setup status:', err);
        wsSend(ws, 'setup-complete', { success: false, error: err.message });
    }
}

async function handleValidateApiKey(data, ctx) {
    const { ws } = ctx;
    const { provider, key, endpoint } = data.payload;
    
    try {
        const result = await validateProviderKey(provider, key, endpoint);
        wsSend(ws, 'api-key-validation', result);
    } catch (err) {
        wsSend(ws, 'api-key-validation', { valid: false, error: err.message });
    }
}

async function validateProviderKey(provider, key, endpoint) {
    // Minimal API calls to verify key validity
    switch (provider) {
        case 'openai': {
            try {
                const res = await fetch('https://api.openai.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${key}` }
                });
                if (res.ok) return { valid: true };
                return { valid: false, error: `OpenAI API returned ${res.status}: ${res.statusText}` };
            } catch (err) {
                 return { valid: false, error: `Connection failed: ${err.message}` };
            }
        }
        case 'gemini': {
            try {
                // Using a simple models list call
                const res = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
                );
                if (res.ok) return { valid: true };
                const errorBody = await res.text();
                return { valid: false, error: `Google API returned ${res.status}. ${errorBody}` };
            } catch (err) {
                 return { valid: false, error: `Connection failed: ${err.message}` };
            }
        }
        case 'anthropic': {
            try {
                // Anthropic requires a specific version header
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-3-haiku-20240307',
                        max_tokens: 1,
                        messages: [{ role: 'user', content: 'hi' }]
                    })
                });
                // 200 = valid
                if (res.ok) return { valid: true };
                
                // 401 = definitely bad key
                if (res.status === 401) return { valid: false, error: 'Invalid API key' };
                
                // 400 could be model access, but usually means auth passed. 
                // However, strictly checking auth failure is safest.
                // Let's assume if we get a 4xx that isn't 401, the key MIGHT be valid but the request was malformed/model unavailable.
                // But for setup wizard, we want to be strict about "working".
                // Actually, if we get 'credit limit exceeded' (429) or 'overloaded' (529), the key IS valid.
                if (res.status === 401 || res.status === 403) {
                     return { valid: false, error: `Auth failed: ${res.status}` };
                }
                
                return { valid: true }; 
            } catch (err) {
                 return { valid: false, error: `Connection failed: ${err.message}` };
            }
        }
        case 'lmstudio':
            // If endpoint provided, try to ping it
            if (endpoint) {
                 try {
                    // We expect an OpenAI-compatible endpoint like .../v1/chat/completions
                    // But we want to validate we can fetch models
                    
                    // 1. Try fetching models from the base URL (assuming standard OAI structure)
                    let modelsUrl = endpoint;
                    if (modelsUrl.includes('/chat/completions')) {
                        modelsUrl = modelsUrl.replace('/chat/completions', '/models');
                    } else if (modelsUrl.endsWith('/v1')) {
                        modelsUrl = `${modelsUrl}/models`;
                    } else if (!modelsUrl.endsWith('/models')) {
                        // Guess /v1/models if it looks like a root
                        modelsUrl = `${modelsUrl.replace(/\/$/, '')}/v1/models`;
                    }

                    const res = await fetch(modelsUrl);
                    if (res.ok) return { valid: true };

                    // 2. If that fails, try Native API for models (http://host:port/api/v1/models)
                    // Extract origin
                    try {
                        const urlObj = new URL(endpoint);
                        const nativeUrl = `${urlObj.protocol}//${urlObj.host}/api/v1/models`;
                        const nativeRes = await fetch(nativeUrl);
                        if (nativeRes.ok) return { valid: true };
                    } catch {}

                    return { valid: true, warning: `Server reachable but models check failed (${res.status})` };
                 } catch (err) {
                     return { valid: false, error: `Could not reach LM Studio server: ${err.message}` };
                 }
            }
            return { valid: true };
        default:
            return { valid: false, error: 'Unknown provider' };
    }
}

export const handlers = {
    'get-setup-status': handleGetSetupStatus,
    'complete-setup': handleCompleteSetup,
    'validate-api-key': handleValidateApiKey
};

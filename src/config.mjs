import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { consoleStyler } from './ui/console-styler.mjs';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Infer provider from model name prefix.
 * Duplicated from model-registry to avoid circular imports.
 */
function inferProviderFromModel(modelId) {
  if (!modelId) return 'openai';
  const m = modelId.toLowerCase();
  if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'gemini';
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('chatgpt-')) return 'openai';
  if (m.startsWith('claude-')) return 'anthropic';
  return 'lmstudio';
}

const _aiModel = process.env.AI_MODEL || 'gpt-4o';
const _detectedProvider = process.env.AI_PROVIDER || inferProviderFromModel(_aiModel);

// Default models per provider
const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-20250514',
  lmstudio: '',
};

/**
 * Centralized configuration for the AI Assistant
 */
export const config = {
  // AI Configuration
  ai: {
    model: _aiModel, // Default model
    provider: _detectedProvider, // Auto-detected from model name. Options: 'lmstudio', 'openai', 'gemini', 'anthropic'
    endpoint: process.env.AI_ENDPOINT || 'http://localhost:1234/v1/chat/completions',
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4096', 10),
    contextWindowSize: parseInt(process.env.AI_CONTEXT_WINDOW || '128000', 10),
    maxTurns: parseInt(process.env.AI_MAX_TURNS || '100', 10),
    // Per-provider configuration
    providers: {
      openai: {
        enabled: _detectedProvider === 'openai' || !!process.env.OPENAI_API_KEY,
        model: _detectedProvider === 'openai' ? _aiModel : DEFAULT_MODELS.openai,
      },
      gemini: {
        enabled: _detectedProvider === 'gemini' || !!process.env.GOOGLE_API_KEY,
        model: _detectedProvider === 'gemini' ? _aiModel : DEFAULT_MODELS.gemini,
      },
      anthropic: {
        enabled: _detectedProvider === 'anthropic' || !!process.env.ANTHROPIC_API_KEY,
        model: _detectedProvider === 'anthropic' ? _aiModel : DEFAULT_MODELS.anthropic,
      },
      lmstudio: {
        enabled: _detectedProvider === 'lmstudio',
        model: _detectedProvider === 'lmstudio' ? _aiModel : DEFAULT_MODELS.lmstudio,
        endpoint: process.env.AI_ENDPOINT || 'http://localhost:1234/v1/chat/completions',
      },
      cloud: {
        enabled: _detectedProvider === 'cloud',
        model: _detectedProvider === 'cloud' ? _aiModel : 'auto',
        label: 'Oboto Cloud',
      },
    },
  },

  // Prompt Routing Configuration
  routing: {
    agentic: process.env.ROUTE_AGENTIC || '',
    reasoning_high: process.env.ROUTE_REASONING_HIGH || '',
    reasoning_medium: process.env.ROUTE_REASONING_MEDIUM || '',
    reasoning_low: process.env.ROUTE_REASONING_LOW || '',
    summarizer: process.env.ROUTE_SUMMARIZER || '',
    code_completion: process.env.ROUTE_CODE_COMPLETION || '',
  },

  // Vertex AI Configuration (for Anthropic/Claude)
  vertex: {
    projectId: process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    region: process.env.VERTEX_REGION || 'us-east5',
  },
  
  // System Configuration
  system: {
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    workspaceRoot: process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..'),
  },

  // Tool Configuration
  tools: {
    enableUnsafeTools: process.env.ENABLE_UNSAFE_TOOLS === 'true',
    allowedFileExtensions: (process.env.ALLOWED_FILE_EXTENSIONS || '.js,.mjs,.json,.md,.txt').split(','),
  },

  // Symbolic Continuity Configuration
  symbolicContinuity: {
    enabled: process.env.SYMBOLIC_CONTINUITY !== 'false',  // Default ON
    chineseRoom: process.env.SYMBOLIC_CONTINUITY_CHINESE_ROOM === 'true',  // Default OFF
    secret: process.env.SYMBOLIC_CONTINUITY_SECRET || null,
  },

  // API Keys (accessed safely via getters for live updates from secrets vault)
  keys: {
    get openai() { return process.env.OPENAI_API_KEY; },
    get anthropic() { return process.env.ANTHROPIC_API_KEY; },
    get google() { return process.env.GOOGLE_API_KEY; },
  }
};

/**
 * Enable or disable a provider at runtime.
 * Centralises config mutation so callers don't need to reach into the singleton.
 *
 * @param {string} provider — Provider key (e.g. 'cloud', 'openai')
 * @param {boolean} enabled — Whether the provider should be enabled
 */
export function setProviderEnabled(provider, enabled) {
  if (config.ai.providers[provider]) {
    config.ai.providers[provider].enabled = !!enabled;
  }
}

/**
 * Validate required configuration
 */
export function validateConfig() {
  const missingKeys = [];
  
  // Example validation - uncomment if strict validation is needed
  // if (!config.keys.openai && !config.keys.anthropic) {
  //   missingKeys.push('OPENAI_API_KEY or ANTHROPIC_API_KEY');
  // }

  if (missingKeys.length > 0) {
    consoleStyler.log('warning', `Missing configuration for: ${missingKeys.join(', ')}`);
    return false;
  }
  
  return true;
}

export default config;

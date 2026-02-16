import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Centralized configuration for the AI Assistant
 */
export const config = {
  // AI Configuration
  ai: {
    model: process.env.AI_MODEL || 'gpt-4o', // Default model
    provider: process.env.AI_PROVIDER || '', // Auto-detected from model name if empty. Options: 'local', 'openai', 'gemini'
    endpoint: process.env.AI_ENDPOINT || 'http://localhost:1234/v1/chat/completions',
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4096', 10),
    contextWindowSize: parseInt(process.env.AI_CONTEXT_WINDOW || '128000', 10),
    maxTurns: parseInt(process.env.AI_MAX_TURNS || '30', 10),
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

  // API Keys (accessed safely)
  keys: {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  }
};

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
    console.warn(`Warning: Missing configuration for: ${missingKeys.join(', ')}`);
    return false;
  }
  
  return true;
}

export default config;

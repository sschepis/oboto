import { callProvider, callProviderStream } from '../../core/ai-provider.mjs';

/**
 * Default LLM Adapter that uses the built-in network provider (OpenAI/Gemini/Local)
 */
export class NetworkLLMAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Call the LLM provider
   * @param {Object} requestBody - OpenAI compatible request
   * @returns {Promise<Object>} OpenAI compatible response
   */
  async generateContent(requestBody) {
    // Merge config overrides if any
    const finalRequest = {
      ...requestBody,
      ...this.config
    };
    return await callProvider(finalRequest);
  }

  /**
   * Stream the LLM response
   * @param {Object} requestBody 
   * @returns {Promise<Response>} Fetch response or stream
   */
  async generateContentStream(requestBody) {
    const finalRequest = {
      ...requestBody,
      ...this.config
    };
    return await callProviderStream(finalRequest);
  }
}

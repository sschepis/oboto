/**
 * maha-provider.test.mjs — Tests for MahaProvider routing logic
 * @module src/core/agentic/__tests__/maha-provider.test
 */

import { MahaProvider } from '../maha-provider.mjs';

describe('MahaProvider', () => {
  describe('_scoreComplexity', () => {
    let provider;
    beforeEach(() => {
      provider = new MahaProvider();
    });

    it('should return 0 for empty input', () => {
      expect(provider._scoreComplexity('')).toBe(0);
    });

    it('should score simple questions low', () => {
      const score = provider._scoreComplexity('What is JavaScript?');
      expect(score).toBeLessThan(3);
    });

    it('should score multi-step requests high', () => {
      const score = provider._scoreComplexity(
        'First, create a new file src/utils.mjs, then write a helper function, and finally add tests for it'
      );
      expect(score).toBeGreaterThanOrEqual(3);
    });

    it('should score tool-requiring verbs higher', () => {
      const score = provider._scoreComplexity('Create a new React component with TypeScript');
      expect(score).toBeGreaterThanOrEqual(2);
    });
  });

  describe('_selectProvider', () => {
    let provider;
    beforeEach(() => {
      provider = new MahaProvider();
    });

    it('should return eventic for empty input', () => {
      expect(provider._selectProvider('').route).toBe('eventic');
    });

    it('should detect lmscript commands', () => {
      expect(provider._selectProvider('COMMAND ls -la').route).toBe('lmscript');
    });

    it('should route simple questions to eventic', () => {
      expect(provider._selectProvider('What time is it?').route).toBe('eventic');
    });

    it('should return score alongside route', () => {
      const result = provider._selectProvider('First create a file, then edit it');
      expect(result).toHaveProperty('route');
      expect(result).toHaveProperty('score');
      expect(typeof result.score).toBe('number');
    });
  });

  describe('_getCognitiveProvider (registry lookup)', () => {
    it('should prefer registry instance over creating new one', async () => {
      const provider = new MahaProvider();
      const mockCognitive = { run: () => {}, healthCheck: () => ({}) };
      provider._deps = {
        registry: {
          getProvider: (id) => id === 'cognitive' ? mockCognitive : null,
        },
      };
      const result = await provider._getCognitiveProvider();
      expect(result).toBe(mockCognitive);
    });
  });

  describe('_getLMScriptProvider (registry lookup)', () => {
    it('should prefer registry instance over creating new one', async () => {
      const provider = new MahaProvider();
      const mockLmscript = { run: () => {}, healthCheck: () => ({}) };
      provider._deps = {
        registry: {
          getProvider: (id) => id === 'lmscript' ? mockLmscript : null,
        },
      };
      const result = await provider._getLMScriptProvider();
      expect(result).toBe(mockLmscript);
    });
  });
});

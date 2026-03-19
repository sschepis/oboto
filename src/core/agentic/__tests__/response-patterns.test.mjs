/**
 * response-patterns.test.mjs — Tests for response-patterns shared utilities
 * @module src/core/agentic/__tests__/response-patterns.test
 */

import { INTENT_PATTERNS, isIncompleteResponse } from '../response-patterns.mjs';

describe('response-patterns', () => {
  describe('INTENT_PATTERNS', () => {
    it('should export a non-empty array of RegExp', () => {
      expect(Array.isArray(INTENT_PATTERNS)).toBe(true);
      expect(INTENT_PATTERNS.length).toBeGreaterThan(0);
      for (const p of INTENT_PATTERNS) {
        expect(p).toBeInstanceOf(RegExp);
      }
    });
  });

  describe('isIncompleteResponse', () => {
    it('should detect "I will" style announcements', () => {
      expect(isIncompleteResponse('I will create a new file for you')).toBe(true);
    });

    it('should detect "Let me" style announcements', () => {
      expect(isIncompleteResponse("Let me update the configuration")).toBe(true);
    });

    it('should not flag normal responses', () => {
      expect(isIncompleteResponse('The file contains 42 lines of code.')).toBe(false);
    });

    it('should not flag empty input', () => {
      expect(isIncompleteResponse('')).toBe(false);
    });
  });
});

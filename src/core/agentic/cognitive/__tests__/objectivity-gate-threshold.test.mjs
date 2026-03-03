/**
 * Tests that the ObjectivityGate threshold is set correctly and that
 * R=0.60 (3/5 decoders agree) now passes validation.
 *
 * @module src/core/agentic/cognitive/__tests__/objectivity-gate-threshold.test
 */

import { resolveCognitiveConfig, DEFAULT_COGNITIVE_CONFIG } from '../config.mjs';

// We import ObjectivityGate from the tinyaleph package to test threshold behaviour directly.
let ObjectivityGate;
try {
  const boundary = await import('@aleph-ai/tinyaleph/observer');
  ObjectivityGate = boundary.ObjectivityGate || boundary.default?.ObjectivityGate;
} catch {
  // Fallback: skip tests if the package isn't available
  ObjectivityGate = null;
}

describe('ObjectivityGate threshold configuration', () => {
  test('DEFAULT_COGNITIVE_CONFIG sets objectivityThreshold to 0.6 in cognitive section', () => {
    expect(DEFAULT_COGNITIVE_CONFIG.cognitive.objectivityThreshold).toBe(0.6);
  });

  test('DEFAULT_COGNITIVE_CONFIG sets objectivityThreshold to 0.6 in agent section', () => {
    expect(DEFAULT_COGNITIVE_CONFIG.agent.objectivityThreshold).toBe(0.6);
  });

  test('resolveCognitiveConfig preserves default threshold when no override given', () => {
    const config = resolveCognitiveConfig();
    expect(config.cognitive.objectivityThreshold).toBe(0.6);
    expect(config.agent.objectivityThreshold).toBe(0.6);
  });

  test('resolveCognitiveConfig allows user override of threshold', () => {
    const config = resolveCognitiveConfig({
      cognitive: { objectivityThreshold: 0.4 },
      agent: { objectivityThreshold: 0.4 }
    });
    expect(config.cognitive.objectivityThreshold).toBe(0.4);
    expect(config.agent.objectivityThreshold).toBe(0.4);
  });
});

// Only run ObjectivityGate integration tests if the package is available
const describeGate = ObjectivityGate ? describe : describe.skip;

describeGate('ObjectivityGate with threshold=0.6', () => {
  test('R=0.60 (3/5 decoders agree) passes gate with threshold 0.6', () => {
    const gate = new ObjectivityGate({ threshold: 0.6 });

    // The gate has 5 default decoders. We need a response that gets exactly 3/5.
    // A normal, safe, identity-consistent response that doesn't end with
    // punctuation and has low word overlap will typically get:
    //   coherence=agrees, safety=agrees, identity=agrees,
    //   completeness=disagrees (no trailing punctuation), relevance=varies
    //
    // To force exactly 3/5, we use a custom gate with controlled decoders.
    const controlledGate = new ObjectivityGate({
      threshold: 0.6,
      decoders: [
        { name: 'd1', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd2', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd3', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd4', decode: () => ({ agrees: false, confidence: 0 }) },
        { name: 'd5', decode: () => ({ agrees: false, confidence: 0 }) },
      ]
    });

    const result = controlledGate.check('test output', {});
    expect(result.R).toBe(0.6);
    expect(result.shouldBroadcast).toBe(true);
  });

  test('R=0.60 would FAIL with old threshold of 0.7', () => {
    const controlledGate = new ObjectivityGate({
      threshold: 0.7,
      decoders: [
        { name: 'd1', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd2', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd3', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd4', decode: () => ({ agrees: false, confidence: 0 }) },
        { name: 'd5', decode: () => ({ agrees: false, confidence: 0 }) },
      ]
    });

    const result = controlledGate.check('test output', {});
    expect(result.R).toBe(0.6);
    expect(result.shouldBroadcast).toBe(false);
  });

  test('R=0.40 (2/5 decoders agree) still fails with threshold 0.6', () => {
    const controlledGate = new ObjectivityGate({
      threshold: 0.6,
      decoders: [
        { name: 'd1', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd2', decode: () => ({ agrees: true, confidence: 1 }) },
        { name: 'd3', decode: () => ({ agrees: false, confidence: 0 }) },
        { name: 'd4', decode: () => ({ agrees: false, confidence: 0 }) },
        { name: 'd5', decode: () => ({ agrees: false, confidence: 0 }) },
      ]
    });

    const result = controlledGate.check('test output', {});
    expect(result.R).toBe(0.4);
    expect(result.shouldBroadcast).toBe(false);
  });
});

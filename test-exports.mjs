#!/usr/bin/env node
/**
 * Quick verification script for npm library exports.
 * Run: node test-exports.mjs
 */

const expected = [
  'AiMan', 'Oboto', 'ConsoleStatusAdapter', 'NetworkLLMAdapter',
  'MemoryAdapter', 'AiManEventBus', 'MiddlewareChain',
  'CancellationError', 'DesignResult', 'WorkflowService',
  'FlowManager', 'ManifestManager', 'config', 'consoleStyler',
  'AssistantFacade', 'MiniAIAssistant',
  'C4Visualizer', 'KnowledgeGraphBuilder', 'CiCdArchitect',
  'ContainerizationWizard', 'ApiDocSmith', 'TutorialGenerator',
  'EnhancementGenerator'
];

console.log('Testing main entry point: src/lib/index.mjs');
console.log('---');

try {
  const m = await import('./src/lib/index.mjs');
  const allKeys = Object.keys(m);
  const missing = expected.filter(e => !(e in m));
  const extra = allKeys.filter(k => !expected.includes(k));

  if (missing.length) {
    console.error('❌ MISSING exports:', missing.join(', '));
  } else {
    console.log(`✅ All ${expected.length} expected exports present`);
  }

  if (extra.length) {
    console.log(`ℹ️  Additional exports not checked: ${extra.join(', ')}`);
  }

  console.log(`\nTotal exports: ${allKeys.length}`);
  console.log('Export names:', allKeys.join(', '));

  // Test adapters barrel
  console.log('\n--- Testing adapters barrel: src/lib/adapters/index.mjs ---');
  const adapters = await import('./src/lib/adapters/index.mjs');
  const adapterExpected = ['ConsoleStatusAdapter', 'NetworkLLMAdapter', 'MemoryAdapter'];
  const adapterMissing = adapterExpected.filter(e => !(e in adapters));
  if (adapterMissing.length) {
    console.error('❌ MISSING adapter exports:', adapterMissing.join(', '));
  } else {
    console.log(`✅ All ${adapterExpected.length} adapter exports present`);
  }

  // Test instantiation
  console.log('\n--- Testing basic instantiation ---');
  const { AiMan: TestAiMan } = m;
  const instance = new TestAiMan({ workingDir: '/tmp/test' });
  console.log('✅ AiMan instantiation OK');
  console.log('   workingDir:', instance.workingDir);
  console.log('   has events:', !!instance.events);
  console.log('   has middleware:', !!instance.middleware);

  if (missing.length) process.exit(1);
  console.log('\n🎉 All checks passed!');
} catch (e) {
  console.error('❌ Library entry FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
}

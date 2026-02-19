import type { Message } from '../types';

export const generateMockResponse = (input: string): Message => {
  // Simple heuristic to generate different types of messages based on input
  const lowerInput = input.toLowerCase();

  if (lowerInput.includes('analyze') || lowerInput.includes('/analyze')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'background-tasks',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      tasks: [
        { name: "Neural Indexer", subtext: "Scanning shared memory vectors", progress: 45, status: 'running', logs: ["Node 0xFA mapping complete", "Hash collisions resolved"] },
        { name: "Pattern Recognition", subtext: "Identifying structural anomalies", progress: 12, status: 'running' }
      ]
    };
  }

  if (lowerInput.includes('visualize') || lowerInput.includes('/visualize')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'visualization',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: "Rendering neural topology map..."
    };
  }

  if (lowerInput.includes('sandbox') || lowerInput.includes('/sandbox')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'html-sandbox',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      code: `<!DOCTYPE html><html><body class="bg-black text-white p-8 flex items-center justify-center h-screen"><div class="text-center"><h1 class="text-4xl font-bold mb-4">Oboto Sandbox</h1><p class="text-gray-400">Environment Active</p></div></body></html>`
    };
  }

  if (lowerInput.includes('survey') || lowerInput.includes('/survey')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'survey',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      question: "How should we proceed with the integration?",
      options: ["Direct Integration", "Proxy Adapter", "Asynchronous Queue"]
    };
  }

  if (lowerInput.includes('diff') || lowerInput.includes('/diff')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'code-diff',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      filename: 'substrate_core.ts',
      oldCode: 'const latency = 200;',
      newCode: 'const latency = await measureLatency();'
    };
  }

  if (lowerInput.includes('telemetry') || lowerInput.includes('/telemetry')) {
    return {
      id: Date.now().toString(),
      role: 'ai',
      type: 'telemetry',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  }

  if (lowerInput.includes('lock') || lowerInput.includes('/lock')) {
     // Handled by App state, but message could confirm
     return {
        id: Date.now().toString(),
        role: 'ai',
        type: 'text',
        content: "Terminal lock sequence initiated.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
     }
  }

  // Default response
  return {
    id: Date.now().toString(),
    role: 'ai',
    type: 'agent-execution',
    title: `Oboto Response to: ${input.substring(0, 20)}...`,
    status: 'completed',
    steps: [
      { label: 'Intent mapped', status: 'done' }, 
      { label: 'Handshake complete', status: 'done' },
      { label: 'Response synthesized', status: 'done' }
    ],
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
};

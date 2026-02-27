class WSService {
  private ws: WebSocket | null = null;
  private listeners: Record<string, ((payload: unknown) => void)[]> = {};
  private pendingRequests: Record<string, { resolve: (val: string | null) => void; reject: (err: unknown) => void; timer: ReturnType<typeof setTimeout> }> = {};
  private reconnectAttempts = 0;

  requestCompletion(payload: { filePath: string; language: string; content: string; cursorOffset: number; line: number; column: number }): Promise<string | null> {
    const id = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests[id]) {
          delete this.pendingRequests[id];
          resolve(null);
        }
      }, 5000);

      this.pendingRequests[id] = { resolve, reject, timer };
      
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'code-completion-request', id, payload }));
      } else {
         clearTimeout(timer);
         delete this.pendingRequests[id];
         resolve(null);
      }
    });
  }

  connect() {
    // Guard: skip if a connection is already open or in progress.
    // React StrictMode double-mounts useEffect, which calls connect() twice —
    // this prevents duplicate WebSocket connections (and the resulting
    // duplicate set-cwd → OpenClaw restart cascade).
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WS connect() skipped — already connected or connecting');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'localhost:3000' 
      : window.location.host;
      
    const url = `${protocol}//${host}`;
    
    console.log('Connecting to WS:', url);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WS Connected');
      this.reconnectAttempts = 0;
      this.emit('connected', null);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle completion response specifically
        if (data.type === 'code-completion-response') {
          const req = this.pendingRequests[data.id];
          if (req) {
            clearTimeout(req.timer);
            req.resolve(data.payload?.completion);
            delete this.pendingRequests[data.id];
          }
          return;
        }

        this.emit(data.type, data.payload);
      } catch (e) {
        console.error('WS Parse Error', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WS Disconnected');
      this.emit('disconnected', null);
      
      // Auto-reconnect with exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
      console.log(`Reconnecting in ${retryDelay}ms (attempt ${this.reconnectAttempts + 1})...`);
      
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, retryDelay);
    };
  }

  send(text: string, activeSurfaceId?: string, model?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', payload: text, surfaceId: activeSurfaceId || undefined, model: model || undefined }));
    } else {
      console.warn('WS not open');
    }
  }

  interrupt() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'interrupt' }));
    }
  }

  getStatus() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-status' }));
    }
  }

  setCwd(path: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set-cwd', payload: path }));
    }
  }

  getSettings() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-settings' }));
    }
  }

  getFiles(dirPath?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-files', payload: dirPath || null }));
    }
  }

  readFile(filePath: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'read-file', payload: filePath }));
    }
  }

  readMediaFile(filePath: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'read-media-file', payload: filePath }));
    }
  }

  listDirs(dirPath?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'list-dirs', payload: dirPath || '/' }));
    }
  }

  createDir(dirPath: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'create-dir', payload: dirPath }));
    }
  }

  deleteFile(path: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete-file', payload: path }));
    }
  }

  copyFile(source: string, destination: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'copy-file', payload: { source, destination } }));
    }
  }

  uploadFile(name: string, data: string, encoding = 'base64') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'upload-file', payload: { name, data, encoding } }));
    }
  }

  saveFile(filePath: string, content: string, encoding?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'save-file', payload: { path: filePath, content, encoding } }));
    }
  }

  runTests(command?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'run-tests', payload: { command } }));
    }
  }

  getOpenClawStatus() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'openclaw-status' }));
    }
  }

  configureOpenClaw(config: { mode?: string; url?: string; authToken?: string; path?: string; restart?: boolean }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'openclaw-config', payload: config }));
    }
  }

  deployOpenClaw(config?: { mode?: string; url?: string; authToken?: string; path?: string }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'openclaw-deploy', payload: config }));
    }
  }

  // --- Setup Wizard methods ---

  getSetupStatus() {
    this.sendMessage('get-setup-status');
  }

  completeSetup(config: { provider: string; openclawEnabled: boolean }) {
    this.sendMessage('complete-setup', config);
  }

  validateApiKey(provider: string, key: string, endpoint?: string): Promise<{ valid: boolean; error?: string }> {
    return new Promise((resolve) => {
        const unsub = this.on('api-key-validation', (payload: unknown) => {
            unsub();
            resolve(payload as { valid: boolean; error?: string });
        });
        // Timeout after 10s
        setTimeout(() => { unsub(); resolve({ valid: false, error: 'Timeout' }); }, 10000);
        this.sendMessage('validate-api-key', { provider, key, endpoint });
    });
  }

  checkOpenClawPrereqs() {
    this.sendMessage('openclaw-check-prereqs');
  }

  installOpenClaw(path: string, method: 'source' | 'npm' | 'docker' = 'source', resumeFrom?: string) {
    this.sendMessage('openclaw-install', { path, method, resumeFrom });
  }

  getSurfaces() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-surfaces' }));
    }
  }

  getSurface(id: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-surface', payload: { id } }));
    }
  }

  createSurface(name: string, description: string = '', layout: string = 'vertical') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'create-surface', payload: { name, description, layout } }));
    }
  }

  updateSurface(surfaceId: string, componentName: string, jsxSource: string, props: Record<string, unknown> = {}, order?: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'update-surface',
        payload: { surface_id: surfaceId, component_name: componentName, jsx_source: jsxSource, props, order }
      }));
    }
  }

  deleteSurface(surfaceId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete-surface', payload: { surface_id: surfaceId } }));
    }
  }

  pinSurface(surfaceId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pin-surface', payload: { surface_id: surfaceId } }));
    }
  }

  sendConfirmationResponse(id: string, decision: 'approved' | 'denied' | 'always-allow') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tool-confirmation-response', payload: { id, decision } }));
    }
  }

  renameSurface(surfaceId: string, name: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'rename-surface', payload: { surface_id: surfaceId, name } }));
    }
  }

  duplicateSurface(surfaceId: string, name?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'duplicate-surface', payload: { surface_id: surfaceId, name } }));
    }
  }

  removeSurfaceComponent(surfaceId: string, componentName: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'remove-surface-component', payload: { surface_id: surfaceId, component_name: componentName } }));
    }
  }

  updateSurfaceLayout(surfaceId: string, layout: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'update-surface-layout', payload: { surface_id: surfaceId, layout } }));
    }
  }

  // --- Workflow (BubbleLab) methods ---

  startWorkflow(surfaceId: string, flowScript: string, flowName?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'start-workflow', payload: { surfaceId, flowScript, flowName } }));
    }
  }

  submitWorkflowInteraction(workflowId: string, interactionId: string, data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'submit-interaction', payload: { workflowId, interactionId, data } }));
    }
  }

  cancelWorkflow(workflowId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cancel-workflow', payload: { workflowId } }));
    }
  }

  getWorkflowStatus(workflowId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-workflow-status', payload: { workflowId } }));
    }
  }

  listWorkflows() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'list-workflows' }));
    }
  }

  updateSettings(settings: { maxTurns: number; maxSubagents: number; ai?: { provider: string; model: string; endpoint?: string; providers?: Record<string, { enabled: boolean; model: string; endpoint?: string }> }; routing?: Record<string, string> }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'update-settings', payload: settings }));
    }
  }

  refreshModels() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'refresh-models' }));
    }
  }

  refreshProviderModels(provider: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'refresh-provider-models', payload: { provider } }));
    }
  }

  deleteMessage(id: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete-message', payload: { id } }));
    }
  }

  // --- Agent Loop methods ---

  agentLoopPlay(intervalMs?: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent-loop-play', payload: { intervalMs } }));
    }
  }

  agentLoopPause() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent-loop-pause' }));
    }
  }

  agentLoopStop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent-loop-stop' }));
    }
  }

  agentLoopSetInterval(intervalMs: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent-loop-set-interval', payload: { intervalMs } }));
    }
  }

  getAgentLoopState() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'get-agent-loop-state' }));
    }
  }

  agentLoopAnswer(questionId: string, answer: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'agent-loop-answer', payload: { questionId, answer } }));
    }
  }

  // --- Skills Management methods ---

  getSkills() {
    this.sendMessage('get-skills');
  }

  searchClawHub(query: string) {
    this.sendMessage('search-clawhub', { query });
  }

  installClawHubSkill(slug: string, version?: string) {
    this.sendMessage('install-clawhub-skill', { slug, version });
  }

  installNpmSkill(packageName: string) {
    this.sendMessage('install-npm-skill', { packageName });
  }

  uninstallSkill(name: string) {
    this.sendMessage('uninstall-skill', { name });
  }

  // --- Conversation Management methods ---

  listConversations() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'list-conversations' }));
    }
  }

  createConversation(name: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'create-conversation', payload: { name } }));
    }
  }

  switchConversation(name: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'switch-conversation', payload: { name } }));
    }
  }

  deleteConversation(name: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'delete-conversation', payload: { name } }));
    }
  }

  renameConversation(oldName: string, newName: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'rename-conversation', payload: { oldName, newName } }));
    }
  }

  clearConversation(name?: string) {
    this.sendMessage('clear-conversation', { name: name || null });
  }

  // --- Agentic Provider methods ---

  getAgenticProviders() {
    this.sendMessage('get-agentic-providers');
  }

  setAgenticProvider(providerId: string) {
    this.sendMessage('set-agentic-provider', { providerId });
  }

  // --- Workspace Task methods ---

  spawnWorkspaceTask(opts: { workspace_path: string; task_description?: string; query: string; context?: string; init_git?: boolean }) {
    this.sendMessage('spawn-workspace-task', opts);
  }

  getWorkspaceTasks() {
    this.sendMessage('get-workspace-tasks');
  }

  // --- Cloud methods ---

  cloudLogin(email: string, password: string) {
    this.sendMessage('cloud:login', { email, password });
  }

  cloudLogout() {
    this.sendMessage('cloud:logout');
  }

  cloudGetStatus() {
    this.sendMessage('cloud:status');
  }

  cloudListWorkspaces() {
    this.sendMessage('cloud:list-workspaces');
  }

  cloudLinkWorkspace(cloudWorkspaceId: string) {
    this.sendMessage('cloud:link-workspace', { cloudWorkspaceId });
  }

  cloudUnlinkWorkspace() {
    this.sendMessage('cloud:unlink-workspace');
  }

  cloudSyncPush() {
    this.sendMessage('cloud:sync-push');
  }

  cloudSyncPull() {
    this.sendMessage('cloud:sync-pull');
  }

  cloudListAgents() {
    this.sendMessage('cloud:list-agents');
  }

  cloudInvokeAgent(slug: string, message: string, history?: unknown[]) {
    this.sendMessage('cloud:invoke-agent', { slug, message, history });
  }

  cloudCreateWorkspace(name: string, description?: string) {
    this.sendMessage('cloud:create-workspace', { name, description });
  }

  cloudListConversations() {
    this.sendMessage('cloud:list-conversations');
  }

  cloudPushConversation(cloudConvId: string, lastSyncAt?: string | null) {
    this.sendMessage('cloud:push-conversation', { cloudConvId, lastSyncAt });
  }

  cloudPullConversation(cloudConvId: string, since?: string | null) {
    this.sendMessage('cloud:pull-conversation', { cloudConvId, since });
  }

  cloudGetUsage() {
    this.sendMessage('cloud:get-usage');
  }

  cloudListModels() {
    this.sendMessage('cloud:list-models');
  }

  /** Send a raw typed message to the server (bypasses the chat wrapper) */
  sendMessage(type: string, payload?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  on(event: string, cb: (payload: unknown) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
    return () => {
      this.listeners[event] = this.listeners[event].filter(fn => fn !== cb);
    };
  }

  private emit(event: string, payload: unknown) {
    this.listeners[event]?.forEach(cb => cb(payload));
  }
}

export const wsService = new WSService();

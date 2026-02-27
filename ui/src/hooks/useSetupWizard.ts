import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

export interface WizardConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint?: string;
  workspace: string;
  openClawEnabled: boolean;
  openClawMode: 'external' | 'integrated';
  openClawUrl?: string;
  openClawAuthToken?: string;
  openClawPath?: string;
}

export interface PrereqResults {
    node: { installed: boolean; version: string | null; sufficient: boolean };
    git: { installed: boolean; version: string | null };
    pnpm: { installed: boolean; version: string | null; sufficient: boolean };
    docker: { installed: boolean; version: string | null };
}

export interface ExistingInstallInfo {
    found: boolean;
    path?: string;
    version?: string;
    isBuilt?: boolean;
    hasNodeModules?: boolean;
}

// Layer 4: synchronous localStorage check — computed once before any render
const _setupCompleted = typeof window !== 'undefined' && !!localStorage.getItem('oboto-setup-completed');

export function useSetupWizard() {
  const [isFirstRun, setIsFirstRun] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(!_setupCompleted);
  
  // Install Progress State
  const [installProgress, setInstallProgress] = useState<{
      step: string;
      status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
      detail: string;
  } | null>(null);
  
  const [installComplete, setInstallComplete] = useState<{
      success: boolean;
      error?: string;
      gatewayUrl?: string;
  } | null>(null);

  const [prereqs, setPrereqs] = useState<{
      prereqs: PrereqResults;
      existingInstall: ExistingInstallInfo;
      defaultPath: string;
  } | null>(null);

  useEffect(() => {
    // Layer 4: if localStorage already flags completion, skip server query entirely.
    // State is already correct via useState initializers above.
    let resolved = _setupCompleted;

    // Listen for setup status (receives from both server push and client request)
    const unsubStatus = wsService.on('setup-status', (payload: unknown) => {
      resolved = true;
      const data = payload as { isFirstRun: boolean };
      setIsFirstRun(data.isFirstRun);
      setIsLoading(false);
      // If server says setup is done, sync localStorage
      if (!data.isFirstRun) {
        localStorage.setItem('oboto-setup-completed', 'true');
      }
    });

    // Request status on mount (queued if WS not yet open — Layer 2)
    if (!_setupCompleted) {
      wsService.getSetupStatus();
    }

    // Layer 3: Retry after 3s if no response yet
    const retryTimer = setTimeout(() => {
      if (!resolved) {
        wsService.getSetupStatus();
      }
    }, 3000);

    // Layer 3: Hard timeout after 6s — never stay stuck in loading
    const hardTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        setIsLoading(false);
        // No localStorage flag and no server response ⇒ assume first run
        setIsFirstRun(true);
      }
    }, 6000);
    
    // Listen for install progress
    const unsubProgress = wsService.on('openclaw-install-progress', (payload: unknown) => {
        setInstallProgress(payload as {
            step: string;
            status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
            detail: string;
        });
    });
    
    const unsubComplete = wsService.on('openclaw-install-complete', (payload: unknown) => {
        setInstallComplete(payload as {
            success: boolean;
            error?: string;
            gatewayUrl?: string;
        });
    });
    
    const unsubPrereqs = wsService.on('openclaw-prereqs', (payload: unknown) => {
        setPrereqs(payload as {
            prereqs: PrereqResults;
            existingInstall: ExistingInstallInfo;
            defaultPath: string;
        });
    });

    return () => {
      unsubStatus();
      clearTimeout(retryTimer);
      clearTimeout(hardTimer);
      unsubProgress();
      unsubComplete();
      unsubPrereqs();
    };
  }, []);

  const validateApiKey = useCallback((provider: string, key: string, endpoint?: string) => {
    return wsService.validateApiKey(provider, key, endpoint);
  }, []);

  const completeSetup = useCallback((config: { provider: string; openclawEnabled: boolean }) => {
    wsService.completeSetup(config);
    setIsFirstRun(false); // Optimistically update local state
    localStorage.setItem('oboto-setup-completed', new Date().toISOString()); // Layer 4
  }, []);

  const skipSetup = useCallback(() => {
    setIsFirstRun(false);
  }, []);
  
  const checkPrereqs = useCallback(() => {
      wsService.checkOpenClawPrereqs();
  }, []);
  
  const installOpenClaw = useCallback((path: string, method: 'source' | 'npm' | 'docker' = 'source', resumeFrom?: string) => {
      setInstallProgress(null);
      setInstallComplete(null);
      wsService.installOpenClaw(path, method, resumeFrom);
  }, []);

  return {
    isFirstRun,
    isLoading,
    validateApiKey,
    completeSetup,
    skipSetup,
    // OpenClaw Install
    checkPrereqs,
    prereqs,
    installOpenClaw,
    installProgress,
    installComplete
  };
}

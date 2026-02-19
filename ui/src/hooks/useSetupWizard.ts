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

export function useSetupWizard() {
  const [isFirstRun, setIsFirstRun] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
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
    // Listen for setup status
    const unsubStatus = wsService.on('setup-status', (payload: unknown) => {
      setIsFirstRun((payload as { isFirstRun: boolean }).isFirstRun);
      setIsLoading(false);
    });

    // Request status on mount
    wsService.getSetupStatus();
    
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

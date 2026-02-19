import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/wsService';

export interface SkillInfo {
  name: string;
  description: string;
  source: 'global' | 'clawhub' | 'npm' | 'workspace';
  version?: string;
  emoji?: string;
  path?: string;
}

export interface ClawHubSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  emoji?: string;
  installed?: boolean;
}

export const useSkills = () => {
  const [installedSkills, setInstalledSkills] = useState<SkillInfo[]>([]);
  const [clawHubResults, setClawHubResults] = useState<ClawHubSkill[]>([]);
  const [clawHubAvailable, setClawHubAvailable] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      wsService.on('skills-list', (payload: unknown) => {
        const data = payload as { skills: SkillInfo[]; clawHubAvailable: boolean };
        setInstalledSkills(data.skills || []);
        setClawHubAvailable(data.clawHubAvailable ?? false);
        setIsLoading(false);
      }),

      wsService.on('clawhub-search-results', (payload: unknown) => {
        setClawHubResults(payload as ClawHubSkill[]);
        setIsLoading(false);
      }),

      wsService.on('skill-install-progress', (payload: unknown) => {
        const data = payload as { status: string; message: string };
        setInstallProgress(data.message);
      }),

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      wsService.on('skill-installed', (_payload: unknown) => {
        setIsInstalling(false);
        setInstallProgress(null);
        setError(null);
      }),

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      wsService.on('skill-uninstalled', (_payload: unknown) => {
        setIsInstalling(false);
        setError(null);
      }),

      wsService.on('skill-error', (payload: unknown) => {
        const data = payload as { message: string };
        setError(data.message);
        setIsInstalling(false);
        setIsLoading(false);
        setInstallProgress(null);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, []);

  const fetchSkills = useCallback(() => {
    setIsLoading(true);
    wsService.getSkills();
  }, []);

  const searchClawHub = useCallback((query: string) => {
    if (!query.trim()) {
      setClawHubResults([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    wsService.searchClawHub(query);
  }, []);

  const installFromClawHub = useCallback((slug: string, version?: string) => {
    setIsInstalling(true);
    setError(null);
    wsService.installClawHubSkill(slug, version);
  }, []);

  const installFromNpm = useCallback((packageName: string) => {
    setIsInstalling(true);
    setError(null);
    wsService.installNpmSkill(packageName);
  }, []);

  const uninstallSkill = useCallback((name: string) => {
    setIsInstalling(true);
    setError(null);
    wsService.uninstallSkill(name);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    installedSkills,
    clawHubResults,
    clawHubAvailable,
    isLoading,
    isInstalling,
    installProgress,
    error,
    fetchSkills,
    searchClawHub,
    installFromClawHub,
    installFromNpm,
    uninstallSkill,
    clearError,
  };
};

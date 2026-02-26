import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/wsService';

export interface CloudUser {
  id: string;
  email: string;
}

export interface CloudProfile {
  displayName: string;
  avatarUrl: string | null;
}

export interface CloudOrg {
  id: string;
  name: string;
  slug: string;
  tier: string;
}

export interface CloudWorkspace {
  id: string;
  name: string;
  slug: string;
  status: string;
  description?: string;
}

export interface CloudAgent {
  id: string;
  name: string;
  slug: string;
  agent_type: string;
  description: string | null;
  status: string;
  avatar_url: string | null;
}

export interface OnlineMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  lastSeen?: string;
}

export interface CloudUsage {
  tokens_used: number;
  daily_limit: number;
  remaining: number;
  tier: string;
  period: string;
  request_count?: number;
  /** True when the user is a system admin (owner/admin role) with unlimited tokens */
  is_unlimited?: boolean;
}

export interface CloudModel {
  id: string;
  name: string;
  provider: string;
  context_window: number;
  tier_required: string;
  capabilities?: string[];
}

export interface CloudState {
  configured: boolean;
  loggedIn: boolean;
  user: CloudUser | null;
  profile: CloudProfile | null;
  org: CloudOrg | null;
  role: string | null;
  linkedWorkspace: { id: string; name: string } | null;
  syncState: 'synced' | 'syncing' | 'offline' | 'error' | 'idle';
  agents: CloudAgent[];
  workspaces: CloudWorkspace[];
  onlineMembers: OnlineMember[];
  loginError: string | null;
  loginLoading: boolean;
  usage: CloudUsage | null;
  cloudModels: CloudModel[];
}

const defaultState: CloudState = {
  configured: false,
  loggedIn: false,
  user: null,
  profile: null,
  org: null,
  role: null,
  linkedWorkspace: null,
  syncState: 'idle',
  agents: [],
  workspaces: [],
  onlineMembers: [],
  loginError: null,
  loginLoading: false,
  usage: null,
  cloudModels: [],
};

/**
 * React hook for Oboto Cloud state.
 * Listens to cloud:* WS events and exposes cloud state + actions.
 * Cloud features are invisible (default state) when cloud is not configured.
 */
export function useCloudSync() {
  const [state, setState] = useState<CloudState>(defaultState);
  const loggedInRef = useRef(false);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // Listen for cloud:status — full state snapshot from server
    unsubs.push(wsService.on('cloud:status', (payload: unknown) => {
      const p = payload as Partial<CloudState>;
      setState(prev => ({
        ...prev,
        configured: p.configured ?? prev.configured,
        loggedIn: p.loggedIn ?? prev.loggedIn,
        user: p.user !== undefined ? p.user : prev.user,
        profile: p.profile !== undefined ? p.profile : prev.profile,
        org: p.org !== undefined ? p.org : prev.org,
        role: p.role !== undefined ? p.role : prev.role,
        linkedWorkspace: p.linkedWorkspace !== undefined ? p.linkedWorkspace : prev.linkedWorkspace,
        syncState: p.syncState ?? prev.syncState,
        loginLoading: false,
        loginError: null,
      }));
    }));

    // Listen for cloud:login-result
    unsubs.push(wsService.on('cloud:login-result', (payload: unknown) => {
      const p = payload as { success: boolean; error?: string } & Partial<CloudState>;
      if (p.success) {
        setState(prev => ({
          ...prev,
          loggedIn: true,
          user: p.user ?? prev.user,
          profile: p.profile ?? prev.profile,
          org: p.org ?? prev.org,
          role: p.role ?? prev.role,
          loginLoading: false,
          loginError: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          loginLoading: false,
          loginError: p.error || 'Login failed',
        }));
      }
    }));

    // Listen for cloud:workspaces
    unsubs.push(wsService.on('cloud:workspaces', (payload: unknown) => {
      setState(prev => ({ ...prev, workspaces: (payload as CloudWorkspace[]) || [] }));
    }));

    // Listen for cloud:agents
    unsubs.push(wsService.on('cloud:agents', (payload: unknown) => {
      setState(prev => ({ ...prev, agents: (payload as CloudAgent[]) || [] }));
    }));

    // Listen for cloud:sync-status
    unsubs.push(wsService.on('cloud:sync-status', (payload: unknown) => {
      const p = payload as { state: CloudState['syncState'] };
      setState(prev => ({ ...prev, syncState: p.state }));
    }));

    // Listen for cloud:presence
    unsubs.push(wsService.on('cloud:presence', (payload: unknown) => {
      setState(prev => ({ ...prev, onlineMembers: (payload as OnlineMember[]) || [] }));
    }));

    // Listen for cloud:usage
    unsubs.push(wsService.on('cloud:usage', (payload: unknown) => {
      setState(prev => ({ ...prev, usage: payload as CloudUsage }));
    }));

    // Listen for cloud:models
    unsubs.push(wsService.on('cloud:models', (payload: unknown) => {
      setState(prev => ({ ...prev, cloudModels: (payload as CloudModel[]) || [] }));
    }));

    // Listen for cloud:error
    unsubs.push(wsService.on('cloud:error', (payload: unknown) => {
      const p = payload as { error: string };
      console.warn('[Cloud]', p.error);
    }));

    // Request initial status on mount
    wsService.cloudGetStatus();

    // Periodic usage auto-refresh every 5 minutes while logged in.
    // Real-time updates already arrive via the cloud:usage event after each
    // cloud AI call, so this is just a safety net / catch-up mechanism.
    const usageInterval = setInterval(() => {
      if (loggedInRef.current) {
        wsService.cloudGetUsage();
      }
    }, 300_000);

    return () => {
      unsubs.forEach(u => u());
      clearInterval(usageInterval);
    };
  }, []);

  // Keep the login ref in sync with state so the interval can check it
  useEffect(() => {
    loggedInRef.current = state.loggedIn;
  }, [state.loggedIn]);

  // ── Actions ──

  const login = useCallback((email: string, password: string) => {
    setState(prev => ({ ...prev, loginLoading: true, loginError: null }));
    wsService.cloudLogin(email, password);
  }, []);

  const logout = useCallback(() => {
    wsService.cloudLogout();
    setState(prev => ({
      ...prev,
      loggedIn: false,
      user: null,
      profile: null,
      org: null,
      role: null,
      linkedWorkspace: null,
      syncState: 'idle',
      agents: [],
      workspaces: [],
    }));
  }, []);

  const listWorkspaces = useCallback(() => {
    wsService.cloudListWorkspaces();
  }, []);

  const linkWorkspace = useCallback((cloudWorkspaceId: string) => {
    wsService.cloudLinkWorkspace(cloudWorkspaceId);
  }, []);

  const unlinkWorkspace = useCallback(() => {
    wsService.cloudUnlinkWorkspace();
  }, []);

  const syncPush = useCallback(() => {
    setState(prev => ({ ...prev, syncState: 'syncing' }));
    wsService.cloudSyncPush();
  }, []);

  const syncPull = useCallback(() => {
    setState(prev => ({ ...prev, syncState: 'syncing' }));
    wsService.cloudSyncPull();
  }, []);

  const listAgents = useCallback(() => {
    wsService.cloudListAgents();
  }, []);

  const invokeAgent = useCallback((slug: string, message: string, history?: unknown[]) => {
    wsService.cloudInvokeAgent(slug, message, history);
  }, []);

  const createWorkspace = useCallback((name: string, description?: string) => {
    wsService.cloudCreateWorkspace(name, description);
  }, []);

  const getUsage = useCallback(() => {
    wsService.cloudGetUsage();
  }, []);

  const listCloudModels = useCallback(() => {
    wsService.cloudListModels();
  }, []);

  return {
    ...state,
    login,
    logout,
    listWorkspaces,
    linkWorkspace,
    unlinkWorkspace,
    syncPush,
    syncPull,
    listAgents,
    invokeAgent,
    createWorkspace,
    getUsage,
    listCloudModels,
  };
}

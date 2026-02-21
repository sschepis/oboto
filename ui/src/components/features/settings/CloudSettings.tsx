import React, { useState, useEffect } from 'react';
import { Cloud, LogOut, User, Building2, Loader2, ExternalLink, Link, Unlink, RefreshCw, Upload, Download, Bot, Plus, FolderOpen, Zap } from 'lucide-react';
import { useCloudSync } from '../../../hooks/useCloudSync';

/**
 * Cloud settings panel for the Settings dialog.
 * Shows login form when not authenticated, full cloud management when logged in.
 * Hidden entirely when cloud is not configured (OBOTO_CLOUD_URL not set).
 */
const CloudSettings: React.FC = () => {
  const cloud = useCloudSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newWsName, setNewWsName] = useState('');
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [agentMessage, setAgentMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Fetch workspaces and agents when logged in
  useEffect(() => {
    if (cloud.loggedIn) {
      cloud.listWorkspaces();
      cloud.listAgents();
    }
  }, [cloud]);

  // Not configured — show setup instructions
  if (!cloud.configured) {
    return (
      <div className="space-y-4">
        <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-6 text-center">
          <Cloud size={32} className="mx-auto mb-3 text-zinc-600" />
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">Cloud Not Configured</h4>
          <p className="text-xs text-zinc-500 mb-4 max-w-sm mx-auto">
            Set <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">OBOTO_CLOUD_URL</code> and{' '}
            <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">OBOTO_CLOUD_KEY</code> in your{' '}
            <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">.env</code> file or Secrets Vault
            to enable cloud features.
          </p>
          <a
            href="https://oboto.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Sign up for Oboto Cloud <ExternalLink size={12} />
          </a>
        </div>
      </div>
    );
  }

  // Not logged in — show login form
  if (!cloud.loggedIn) {
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (email && password) {
        cloud.login(email, password);
      }
    };

    return (
      <div className="space-y-4">
        <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/15 text-indigo-400">
              <Cloud size={16} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">Sign in to Oboto Cloud</h4>
              <p className="text-[10px] text-zinc-500">Sync workspaces, collaborate with your team, and access cloud AI agents.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1 uppercase tracking-wider">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                disabled={cloud.loginLoading} />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 mb-1 uppercase tracking-wider">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                disabled={cloud.loginLoading} />
            </div>
            {cloud.loginError && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                {cloud.loginError}
              </div>
            )}
            <button type="submit" disabled={cloud.loginLoading || !email || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-xs font-bold transition-all duration-200 shadow-lg shadow-indigo-500/20">
              {cloud.loginLoading ? (<><Loader2 size={14} className="animate-spin" />Signing in...</>) : (<><Cloud size={14} />Sign In</>)}
            </button>
          </form>
          <div className="mt-4 text-center">
            <a href="https://oboto.ai/auth" target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
              Don't have an account? Sign up →
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Logged in — Full Cloud Management ──

  const handleCreateWorkspace = () => {
    if (newWsName.trim()) {
      cloud.createWorkspace(newWsName.trim());
      setNewWsName('');
      setShowCreateWs(false);
    }
  };

  const handleInvokeAgent = (slug: string) => {
    if (agentMessage.trim()) {
      cloud.invokeAgent(slug, agentMessage.trim());
      setAgentMessage('');
      setSelectedAgent(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Profile Card */}
      <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {cloud.profile?.avatarUrl ? (
              <img src={cloud.profile.avatarUrl} alt={cloud.profile.displayName}
                className="w-9 h-9 rounded-full border border-zinc-700/50" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <User size={16} />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-zinc-200">{cloud.profile?.displayName || cloud.user?.email || 'User'}</p>
              <p className="text-[10px] text-zinc-500">{cloud.user?.email}</p>
            </div>
          </div>
          <button onClick={() => cloud.logout()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-zinc-800/30 hover:border-red-500/20 transition-all">
            <LogOut size={12} />Sign Out
          </button>
        </div>
        {/* Org info inline */}
        {cloud.org && (
          <div className="mt-3 pt-3 border-t border-zinc-800/20 flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1 text-zinc-500"><Building2 size={11} />{cloud.org.name}</span>
            <span className={`px-1.5 py-0.5 rounded ${cloud.org.tier === 'free' ? 'bg-zinc-800/50 text-zinc-400' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
              {(cloud.org.tier || 'free').charAt(0).toUpperCase() + (cloud.org.tier || 'free').slice(1)}
            </span>
            <span className="text-zinc-600 capitalize">{cloud.role || 'member'}</span>
          </div>
        )}
      </div>

      {/* Workspace Linking */}
      <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-zinc-500" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Workspace Sync</span>
          </div>
          <div className="flex items-center gap-1.5">
            {cloud.linkedWorkspace ? (
              <>
                <button onClick={() => cloud.syncPush()} title="Push local state to cloud"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all"><Upload size={13} /></button>
                <button onClick={() => cloud.syncPull()} title="Pull cloud state"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-green-400 hover:bg-green-500/10 transition-all"><Download size={13} /></button>
                <button onClick={() => cloud.unlinkWorkspace()} title="Unlink workspace"
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"><Unlink size={13} /></button>
              </>
            ) : (
              <button onClick={() => cloud.listWorkspaces()} title="Refresh list"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all"><RefreshCw size={13} /></button>
            )}
          </div>
        </div>

        {cloud.linkedWorkspace ? (
          <div className="flex items-center gap-2 p-2.5 bg-blue-500/5 border border-blue-500/15 rounded-lg">
            <Link size={13} className="text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-blue-300 truncate">{cloud.linkedWorkspace.name || cloud.linkedWorkspace.id}</p>
              <p className="text-[10px] text-zinc-500">
                {cloud.syncState === 'synced' ? '✓ Synced' : cloud.syncState === 'syncing' ? '↻ Syncing...' : cloud.syncState === 'error' ? '✕ Error' : 'Linked'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {cloud.workspaces.length === 0 ? (
              <p className="text-[10px] text-zinc-600 text-center py-2">No cloud workspaces found</p>
            ) : (
              <div className="max-h-32 overflow-y-auto space-y-1 custom-scrollbar">
                {cloud.workspaces.map(ws => (
                  <button key={ws.id} onClick={() => cloud.linkWorkspace(ws.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-zinc-800/40 transition-colors group">
                    <FolderOpen size={12} className="text-zinc-600 group-hover:text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate">{ws.name}</p>
                      <p className="text-[10px] text-zinc-600">{ws.status}</p>
                    </div>
                    <Link size={11} className="text-zinc-700 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all" />
                  </button>
                ))}
              </div>
            )}
            {/* Create new workspace */}
            {showCreateWs ? (
              <div className="flex gap-1.5 mt-1">
                <input type="text" value={newWsName} onChange={e => setNewWsName(e.target.value)}
                  placeholder="Workspace name" autoFocus onKeyDown={e => e.key === 'Enter' && handleCreateWorkspace()}
                  className="flex-1 px-2 py-1.5 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50" />
                <button onClick={handleCreateWorkspace} disabled={!newWsName.trim()}
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white rounded-lg text-[10px] font-bold transition-all">Create</button>
                <button onClick={() => setShowCreateWs(false)}
                  className="px-2 py-1.5 text-zinc-500 hover:text-zinc-300 text-[10px]">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowCreateWs(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-medium text-zinc-500 hover:text-indigo-400 border border-dashed border-zinc-800/50 hover:border-indigo-500/30 rounded-lg transition-all">
                <Plus size={12} />New Cloud Workspace
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cloud Agents */}
      <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-zinc-500" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Cloud Agents</span>
          </div>
          <button onClick={() => cloud.listAgents()} title="Refresh agents"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-all"><RefreshCw size={12} /></button>
        </div>

        {cloud.agents.length === 0 ? (
          <p className="text-[10px] text-zinc-600 text-center py-2">No cloud agents available</p>
        ) : (
          <div className="space-y-1.5">
            {cloud.agents.map(agent => (
              <div key={agent.id} className="rounded-lg border border-zinc-800/20 overflow-hidden">
                <button onClick={() => setSelectedAgent(selectedAgent === agent.slug ? null : agent.slug)}
                  className="w-full flex items-center gap-2.5 p-2.5 hover:bg-zinc-800/30 transition-colors">
                  {agent.avatar_url ? (
                    <img src={agent.avatar_url} alt={agent.name} className="w-6 h-6 rounded-full border border-zinc-700/50" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-purple-500/15 border border-purple-500/20 flex items-center justify-center text-purple-400">
                      <Bot size={12} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-medium text-zinc-300 truncate">{agent.name}</p>
                    {agent.description && <p className="text-[10px] text-zinc-600 truncate">{agent.description}</p>}
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                    agent.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-zinc-800/50 text-zinc-500'
                  }`}>{agent.status}</span>
                </button>
                {selectedAgent === agent.slug && (
                  <div className="p-2.5 pt-0 border-t border-zinc-800/20">
                    <div className="flex gap-1.5 mt-2">
                      <input type="text" value={agentMessage} onChange={e => setAgentMessage(e.target.value)}
                        placeholder={`Ask ${agent.name}...`} onKeyDown={e => e.key === 'Enter' && handleInvokeAgent(agent.slug)}
                        className="flex-1 px-2 py-1.5 bg-zinc-900/50 border border-zinc-800/50 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50" />
                      <button onClick={() => handleInvokeAgent(agent.slug)} disabled={!agentMessage.trim()}
                        className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white rounded-lg text-[10px] font-bold transition-all">Send</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Proxy Info */}
      <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/30 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={14} className="text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">Cloud AI Proxy</span>
        </div>
        <p className="text-[10px] text-zinc-500 mb-2">
          Set <code className="bg-zinc-800 px-1 py-0.5 rounded text-zinc-400">AI_PROVIDER=cloud</code> in your{' '}
          <code className="bg-zinc-800 px-1 py-0.5 rounded text-zinc-400">.env</code> to route AI requests through Oboto Cloud.
          This uses your organization's metered token allowance — no personal API keys needed.
        </p>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-zinc-600">Tier limit:</span>
          <span className="text-zinc-300 font-medium">
            {cloud.org?.tier === 'free' ? '50K tokens/day' : cloud.org?.tier === 'pro' ? '500K tokens/day' : cloud.org?.tier === 'team' ? '2M tokens/day' : '50K tokens/day'}
          </span>
        </div>
      </div>

      {/* Dashboard Link */}
      <div className="text-center pt-1">
        <a href="https://oboto.ai/dashboard" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          Open Cloud Dashboard <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
};

export default CloudSettings;

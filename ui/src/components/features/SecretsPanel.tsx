import React, { useState, useMemo } from 'react';
import { X, Key, Eye, EyeOff, Shield, ShieldCheck, ShieldAlert, Plus, Trash2, Save, RefreshCw, FileText, Lock } from 'lucide-react';
import { useSecrets } from '../../hooks/useSecrets';
import type { SecretItem } from '../../hooks/useSecrets';

interface SecretsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Status Badge ─────────────────────────────────────────────────────────

function StatusBadge({ secret }: { secret: SecretItem }) {
  if (secret.isConfigured && secret.source === 'vault') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 transition-all duration-200">
        <ShieldCheck size={9} /> Vault
      </span>
    );
  }
  if (secret.isConfigured && secret.source === 'env') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-blue-500/10 text-blue-400 border border-blue-500/15 transition-all duration-200">
        <FileText size={9} /> .env
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-400 border border-amber-500/15 animate-glow-pulse transition-all duration-200">
      <ShieldAlert size={9} /> Not Set
    </span>
  );
}

// ── Secret Row ───────────────────────────────────────────────────────────

function SecretRow({ secret, onSet, onDelete }: {
  secret: SecretItem;
  onSet: (name: string, value: string, category?: string, description?: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleSave = () => {
    if (value.trim()) {
      onSet(secret.name, value.trim(), secret.category, secret.description);
      setValue('');
      setEditing(false);
      setVisible(false);
    }
  };

  const handleDelete = () => {
    if (confirming) {
      onDelete(secret.name);
      setConfirming(false);
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditing(false);
      setValue('');
      setVisible(false);
    }
  };

  return (
    <div className="group px-4 py-3 rounded-xl border border-zinc-800/40 bg-zinc-950/30 hover:border-zinc-700/40 hover:bg-zinc-900/20 transition-all duration-200">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Lock size={10} className={`shrink-0 ${secret.isConfigured ? 'text-emerald-500/50' : 'text-zinc-700'}`} />
            <span className="text-xs font-mono font-bold text-zinc-200 truncate">{secret.name}</span>
            <StatusBadge secret={secret} />
          </div>
          <p className="text-[10px] text-zinc-500 truncate ml-[22px]">{secret.description}</p>
          {secret.updatedAt && (
            <p className="text-[9px] text-zinc-600 mt-0.5 ml-[22px] tabular-nums">
              Updated: {new Date(secret.updatedAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-200">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all duration-150 active:scale-95"
            >
              {secret.isConfigured ? 'Update' : 'Set'}
            </button>
          )}
          {secret.isConfigured && secret.source === 'vault' && (
            <button
              onClick={handleDelete}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-150 active:scale-90 ${
                confirming
                  ? 'text-red-400 bg-red-500/15 border border-red-500/20 animate-shake'
                  : 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10'
              }`}
              title={confirming ? 'Click again to confirm' : 'Delete from vault'}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Editing area with slide-down animation */}
      <div className={`overflow-hidden transition-all duration-200 ${editing ? 'max-h-20 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={visible ? 'text' : 'password'}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={secret.isConfigured ? 'Enter new value...' : `Enter ${secret.name}...`}
              className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-4 py-2.5 pr-10 text-sm text-indigo-300 font-mono placeholder:text-zinc-600 focus:border-indigo-500/50 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:ring-0 outline-none transition-all duration-200"
              autoFocus
            />
            <button
              onClick={() => setVisible(!visible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors duration-150"
            >
              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!value.trim()}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-wider transition-all duration-150 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <Save size={12} /> Save
          </button>
          <button
            onClick={() => { setEditing(false); setValue(''); setVisible(false); }}
            className="px-2 py-2.5 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Custom Secret ────────────────────────────────────────────────────

function AddCustomSecret({ onSet }: { onSet: (name: string, value: string, category?: string, description?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [visible, setVisible] = useState(false);

  const handleSave = () => {
    if (name.trim() && value.trim()) {
      onSet(name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), value.trim(), 'Custom', description.trim());
      setName('');
      setValue('');
      setDescription('');
      setOpen(false);
      setVisible(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-dashed border-zinc-700/30 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all duration-200 text-xs font-bold group"
      >
        <Plus size={14} className="group-hover:rotate-90 transition-transform duration-200" /> Add Custom Secret
      </button>
    );
  }

  return (
    <div className="px-4 py-4 rounded-xl border border-indigo-500/15 bg-indigo-500/5 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">New Custom Secret</span>
        <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white transition-colors duration-150 active:scale-90">
          <X size={14} />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="SECRET_NAME (e.g. MY_API_KEY)"
        className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:border-indigo-500/50 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:ring-0 outline-none transition-all duration-200"
        autoFocus
      />
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Secret value..."
          className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-4 py-2.5 pr-10 text-sm text-indigo-300 font-mono placeholder:text-zinc-600 focus:border-indigo-500/50 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:ring-0 outline-none transition-all duration-200"
        />
        <button
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors duration-150"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <input
        type="text"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full bg-zinc-900/60 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-400 placeholder:text-zinc-600 focus:border-indigo-500/50 focus:shadow-[0_0_0_1px_rgba(99,102,241,0.15)] focus:ring-0 outline-none transition-all duration-200"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white transition-colors duration-150"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !value.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-wider transition-all duration-150 active:scale-95"
        >
          <Save size={12} /> Add Secret
        </button>
      </div>
    </div>
  );
}

// ── Secrets Panel (Main) ─────────────────────────────────────────────────

const SecretsPanel: React.FC<SecretsPanelProps> = ({ isOpen, onClose }) => {
  const { secrets, categories, loading, error, setSecret, deleteSecret, refresh } = useSecrets();

  // Group secrets by category
  const grouped = useMemo(() => {
    const groups: Record<string, SecretItem[]> = {};
    for (const cat of categories) {
      groups[cat] = [];
    }
    for (const s of secrets) {
      const cat = s.category || 'Custom';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }
    return groups;
  }, [secrets, categories]);

  // Stats
  const configured = secrets.filter(s => s.isConfigured).length;
  const total = secrets.length;
  const progressPercent = total > 0 ? Math.round((configured / total) * 100) : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0a0a0a] border border-zinc-800/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/40 bg-zinc-900/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">
              <Shield size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Secrets Vault</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {configured}/{total} configured
                </span>
                <span className="text-zinc-800">·</span>
                <span className="text-[10px] text-zinc-600">AES-256-GCM</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={refresh}
              className="p-2 rounded-lg text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800/60 transition-all duration-150 active:scale-90"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800/60 transition-all duration-150 active:scale-90"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {total > 0 && (
          <div className="h-0.5 bg-zinc-900">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-700 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 custom-scrollbar">
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/15 text-red-400 text-xs animate-fade-in">
              {error}
            </div>
          )}

          {loading && secrets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3 animate-fade-in">
              <RefreshCw size={20} className="animate-spin text-indigo-400/50" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-600">Loading secrets...</span>
            </div>
          ) : (
            <>
              {categories.map((cat, catIdx) => {
                const items = grouped[cat];
                if (!items || items.length === 0) {
                  if (cat !== 'Custom') return null;
                }
                return (
                  <div key={cat} className="animate-fade-in" style={{ animationDelay: `${catIdx * 0.05}s` }}>
                    <div className="flex items-center gap-2 mb-3">
                      <Key size={11} className="text-indigo-500/60" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-400/70">{cat}</h3>
                      <div className="flex-1 h-px bg-zinc-800/40" />
                      <span className="text-[9px] text-zinc-600 tabular-nums">
                        {items?.filter(s => s.isConfigured).length || 0}/{items?.length || 0}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items?.map(secret => (
                        <SecretRow
                          key={secret.name}
                          secret={secret}
                          onSet={setSecret}
                          onDelete={deleteSecret}
                        />
                      ))}
                      {cat === 'Custom' && (
                        <AddCustomSecret onSet={setSecret} />
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800/40 bg-zinc-900/10 shrink-0">
          <p className="text-[9px] text-zinc-600 text-center">
            Secrets are encrypted with AES-256-GCM using a machine-derived key. Values never leave the server.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SecretsPanel;

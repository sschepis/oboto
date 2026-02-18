import React, { useState } from 'react';
import { Globe, Terminal, RefreshCw, ChevronDown, ChevronRight, XCircle, Activity, AlertTriangle, MousePointer } from 'lucide-react';

interface BrowserPreviewProps {
  url: string;
  title: string;
  screenshot: string | null; // base64 or null
  logs: string[];
  networkLogs?: string[];
  error?: string;
  lastAction?: { type: string; selector?: string; value?: string; url?: string };
}

const BrowserPreview: React.FC<BrowserPreviewProps> = ({ url, title, screenshot, logs, networkLogs = [], error, lastAction }) => {
  const [showFooter, setShowFooter] = useState(false);
  const [activeTab, setActiveTab] = useState<'console' | 'network'>('console');

  return (
    <div className="w-full bg-[#1e1e1e] border border-zinc-800 rounded-lg overflow-hidden flex flex-col shadow-xl my-4">
      {/* Browser Chrome */}
      <div className="bg-[#2d2d2d] px-4 py-2 flex items-center gap-3 border-b border-zinc-700">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
          <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
        </div>
        
        <div className="flex-1 bg-[#1e1e1e] rounded-md px-3 py-1 flex items-center gap-2 text-xs text-zinc-400">
          <Globe size={12} className="text-zinc-500" />
          <span className="truncate flex-1 font-mono">{url}</span>
          {lastAction && (
              <div className="flex items-center gap-1 text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                  <MousePointer size={10} />
                  <span className="uppercase font-bold">{lastAction.type}</span>
                  {lastAction.selector && <span className="font-mono text-zinc-500 truncate max-w-[100px]">{lastAction.selector}</span>}
              </div>
          )}
          <RefreshCw size={12} className="text-zinc-600 hover:text-zinc-400 cursor-pointer" />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
          <div className="bg-red-900/50 border-b border-red-900/50 px-4 py-2 flex items-center gap-2 text-xs text-red-200">
              <AlertTriangle size={14} className="text-red-400" />
              <span className="font-semibold">Error:</span>
              <span className="font-mono">{error}</span>
          </div>
      )}

      {/* Viewport */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
        {screenshot ? (
          <img 
            src={screenshot} 
            alt={`Screenshot of ${title}`} 
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-zinc-500 flex flex-col items-center gap-2">
             <XCircle size={32} />
             <span>No screenshot available</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#111] border-t border-zinc-800 flex flex-col">
        <div className="flex items-center border-b border-zinc-800">
             <button 
                onClick={() => { setShowFooter(!showFooter); setActiveTab('console'); }}
                className={`flex-1 px-4 py-2 flex items-center gap-2 text-xs font-medium transition-colors ${activeTab === 'console' && showFooter ? 'text-zinc-200 bg-zinc-800/50' : 'text-zinc-400 hover:bg-zinc-800/30'}`}
            >
                <Terminal size={12} />
                <span>Console ({logs.length})</span>
            </button>
            <div className="w-px h-4 bg-zinc-800"></div>
            <button 
                onClick={() => { setShowFooter(!showFooter); setActiveTab('network'); }}
                className={`flex-1 px-4 py-2 flex items-center gap-2 text-xs font-medium transition-colors ${activeTab === 'network' && showFooter ? 'text-zinc-200 bg-zinc-800/50' : 'text-zinc-400 hover:bg-zinc-800/30'}`}
            >
                <Activity size={12} />
                <span>Network ({networkLogs.length})</span>
            </button>
             <button 
                onClick={() => setShowFooter(!showFooter)}
                className="px-3 text-zinc-500 hover:text-zinc-300"
            >
                {showFooter ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
        </div>

        {showFooter && (
            <div className="p-2 max-h-40 overflow-y-auto font-mono text-[10px] space-y-1 bg-[#050505]">
                {activeTab === 'console' ? (
                    logs.length === 0 ? (
                        <div className="text-zinc-600 italic px-2">No console logs</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="px-2 py-0.5 border-b border-zinc-900/50 last:border-0 text-zinc-300 break-all">
                                {log}
                            </div>
                        ))
                    )
                ) : (
                    networkLogs.length === 0 ? (
                        <div className="text-zinc-600 italic px-2">No network logs</div>
                    ) : (
                        networkLogs.map((log, i) => (
                            <div key={i} className="px-2 py-0.5 border-b border-zinc-900/50 last:border-0 text-zinc-400 break-all">
                                {log}
                            </div>
                        ))
                    )
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default BrowserPreview;

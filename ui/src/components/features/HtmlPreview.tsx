import React, { useEffect, useState } from 'react';
import { wsService } from '../../services/wsService';
import { Loader2, Eye, RefreshCw, Code2 } from 'lucide-react';

interface HtmlPreviewProps {
  filePath: string;
  onSwitchToEditor?: (filePath: string) => void;
}

/**
 * Loads an HTML file via WebSocket and renders it inside an iframe
 * using srcDoc, sandboxed with allow-scripts.
 */
const HtmlPreview: React.FC<HtmlPreviewProps> = ({ filePath, onSwitchToEditor }) => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = wsService.on('file-content', (payload: unknown) => {
      const p = payload as { path: string; content: string };
      if (p.path === filePath) {
        setContent(p.content);
      }
    });

    const unsubErr = wsService.on('error', (payload: unknown) => {
      const msg = payload as string;
      if (msg.includes('read file')) {
        setError(msg);
      }
    });

    wsService.readFile(filePath);

    return () => {
      unsub();
      unsubErr();
    };
  }, [filePath]);

  const handleReload = () => {
    setContent(null);
    setError(null);
    wsService.readFile(filePath);
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e]">
        <div className="text-red-400/80 text-xs font-medium animate-fade-in">{error}</div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e]">
        <div className="flex items-center gap-2 text-zinc-600 text-xs animate-fade-in">
          <Loader2 size={14} className="animate-spin text-indigo-400/40" />
          <span className="font-mono">{filePath.split('/').pop()}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white rounded-none overflow-hidden">
      {/* Toolbar */}
      <div className="bg-zinc-100 px-4 py-2 border-b border-zinc-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <Eye size={13} className="text-zinc-400" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
            Preview — {filePath.split('/').pop()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onSwitchToEditor && (
            <button
              onClick={() => onSwitchToEditor(filePath)}
              className="p-1.5 rounded-md hover:bg-zinc-200 transition-all duration-150 active:scale-90"
              title="Open in editor"
            >
              <Code2 size={13} className="text-zinc-500" />
            </button>
          )}
          <button
            onClick={handleReload}
            className="p-1.5 rounded-md hover:bg-zinc-200 transition-all duration-150 active:scale-90"
            title="Reload"
          >
            <RefreshCw size={13} className="text-zinc-500" />
          </button>
        </div>
      </div>
      {/* Iframe sandbox */}
      <div className="flex-1 min-h-0">
        <iframe
          title={`preview-${filePath}`}
          srcDoc={content}
          className="w-full h-full border-none"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
};

export default HtmlPreview;

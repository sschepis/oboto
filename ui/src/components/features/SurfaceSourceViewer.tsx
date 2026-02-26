/**
 * SurfaceSourceViewer — Read-only Monaco editor displaying
 * the combined JSX/TSX source code for all components in a surface.
 */
import React, { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { Loader2, Code2 } from 'lucide-react';
import type { SurfaceData } from '../../hooks/useSurface';

interface SurfaceSourceViewerProps {
  surfaceId: string;
  data: SurfaceData | null;
  sources: Record<string, string>;
}

export const SurfaceSourceViewer: React.FC<SurfaceSourceViewerProps> = ({
  surfaceId,
  data,
  sources,
}) => {
  // Build a single combined source string from all component sources
  const combinedSource = useMemo(() => {
    if (!data) return '';

    const parts: string[] = [];
    parts.push(`// Surface: ${data.name}`);
    if (data.description) {
      parts.push(`// ${data.description}`);
    }
    parts.push(`// ID: ${surfaceId}`);
    parts.push(`// Layout: ${typeof data.layout === 'string' ? data.layout : JSON.stringify(data.layout)}`);
    parts.push(`// Components: ${data.components.length}`);
    parts.push('');

    if (data.components.length === 0) {
      parts.push('// (No components in this surface)');
    }

    for (const comp of data.components) {
      const source = sources[comp.id];
      parts.push(`// ─── Component: ${comp.name} ─────────────────────────────────`);
      parts.push(`// Source file: ${comp.sourceFile}`);
      parts.push(`// Order: ${comp.order}`);
      if (Object.keys(comp.props).length > 0) {
        parts.push(`// Props: ${JSON.stringify(comp.props)}`);
      }
      parts.push('');
      if (source) {
        parts.push(source);
      } else {
        parts.push('// (Source not loaded)');
      }
      parts.push('');
    }

    return parts.join('\n');
  }, [data, sources, surfaceId]);

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-xs uppercase tracking-widest">Loading surface source...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#080808] min-h-0 overflow-hidden text-zinc-200 w-full min-w-0">
      {/* Header */}
      <div className="h-9 border-b border-zinc-800/60 flex items-center justify-between px-3 bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={13} className="text-cyan-400 shrink-0" />
          <h2 className="text-[12px] font-bold text-zinc-200 truncate">Source: {data.name}</h2>
          <span className="text-[10px] text-zinc-600 truncate hidden md:inline">
            {data.components.length} component{data.components.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="typescript"
          theme="vs-dark"
          value={combinedSource}
          options={{
            readOnly: true,
            minimap: { enabled: true },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            padding: { top: 12 },
            domReadOnly: true,
          }}
          loading={
            <div className="flex items-center justify-center h-full text-zinc-500">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-xs">Loading editor...</span>
            </div>
          }
        />
      </div>
    </div>
  );
};

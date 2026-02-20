import React, { useState } from 'react';
import { AlertTriangle, ChevronRight, ChevronDown, Wrench, RefreshCw, Code2, Bug } from 'lucide-react';

interface AutoFixData {
  surfaceId: string;
  componentName: string;
  errorType: string;
  attempt: string;
  error: string;
  source: string;
  instructions: string;
}

interface SurfaceAutoFixBlockProps {
  content: string;
}

/**
 * Parse raw [Surface Auto-Fix Request] text into structured data.
 */
function parseAutoFixContent(content: string): AutoFixData | null {
  try {
    const surfaceIdMatch = content.match(/Surface ID:\s*(.+)/);
    const componentMatch = content.match(/Component:\s*(.+)/);
    const errorTypeMatch = content.match(/Error Type:\s*(.+)/);
    const attemptMatch = content.match(/Attempt:\s*(.+)/);

    // Extract error section (between ERROR: and BROKEN SOURCE CODE:)
    const errorMatch = content.match(/ERROR:\n([\s\S]*?)(?=\nBROKEN SOURCE CODE:|\nINSTRUCTIONS:)/);

    // Extract source code (between ```jsx and ```)
    const sourceMatch = content.match(/```jsx\n([\s\S]*?)```/);

    // Extract instructions section
    const instructionsMatch = content.match(/INSTRUCTIONS:\n([\s\S]*?)$/);

    if (!surfaceIdMatch || !componentMatch) return null;

    return {
      surfaceId: surfaceIdMatch[1].trim(),
      componentName: componentMatch[1].trim(),
      errorType: errorTypeMatch?.[1]?.trim() || 'unknown',
      attempt: attemptMatch?.[1]?.trim() || '?/?',
      error: errorMatch?.[1]?.trim() || '',
      source: sourceMatch?.[1]?.trim() || '(source unavailable)',
      instructions: instructionsMatch?.[1]?.trim() || '',
    };
  } catch {
    return null;
  }
}

/** Collapsible section with syntax-like styling */
const CollapsibleCode: React.FC<{
  label: string;
  content: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
}> = ({ label, content, icon, defaultOpen = false, bgColor = 'bg-zinc-900/50', textColor = 'text-zinc-400', borderColor = 'border-zinc-800/30' }) => {
  const [expanded, setExpanded] = useState(defaultOpen);
  const lines = content.split('\n').length;

  return (
    <div className={`rounded-lg border ${borderColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center gap-2 px-3 py-2 ${bgColor} hover:bg-zinc-800/60 transition-colors text-left`}
      >
        {icon}
        <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor} flex-1`}>
          {label}
        </span>
        <span className="text-[9px] text-zinc-600 font-mono mr-2">
          {lines} line{lines !== 1 ? 's' : ''}
        </span>
        <span className="text-zinc-600">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <pre className={`p-3 text-[11px] font-mono leading-relaxed ${textColor} whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto animate-fade-in`}>
          {content}
        </pre>
      )}
    </div>
  );
};

const SurfaceAutoFixBlock: React.FC<SurfaceAutoFixBlockProps> = ({ content }) => {
  const data = parseAutoFixContent(content);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!data) {
    // Fallback: render raw content if parsing fails
    return (
      <div className="w-full bg-[#0a0a0a] border border-amber-500/20 rounded-xl p-4 text-[12px] font-mono text-amber-200/80 whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  // Extract attempt numbers
  const [currentAttempt, maxAttempts] = data.attempt.split('/').map(s => s.trim());

  return (
    <div className="w-full bg-[#0a0a0a] border border-amber-500/20 rounded-xl overflow-hidden shadow-lg shadow-black/10 my-2 transition-all duration-300 hover:border-amber-500/30 animate-fade-in-up">
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-amber-500/10 to-orange-500/5 border-b border-amber-500/15 cursor-pointer hover:from-amber-500/15 hover:to-orange-500/10 transition-all"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="p-1.5 rounded-lg bg-amber-500/15">
          <Wrench size={14} className="text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-amber-300/90 tracking-wide">
            Surface Auto-Fix
          </div>
          <div className="text-[10px] text-zinc-500 font-mono truncate">
            {data.componentName}
          </div>
        </div>

        {/* Attempt badge */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/30">
          <RefreshCw size={10} className="text-zinc-500" />
          <span className="text-[9px] font-bold text-zinc-400 tracking-wider">
            {currentAttempt}<span className="text-zinc-600">/{maxAttempts}</span>
          </span>
        </div>

        {/* Error type badge */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider ${
          data.errorType === 'runtime'
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
        }`}>
          <Bug size={9} />
          {data.errorType}
        </div>

        <span className="text-zinc-600 transition-transform duration-200">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>

      {/* Body */}
      {!isCollapsed && (
        <div className="p-4 space-y-3 animate-fade-in">
          {/* Metadata row */}
          <div className="flex flex-wrap gap-3 text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-600 font-bold uppercase tracking-wider">Surface</span>
              <code className="px-1.5 py-0.5 rounded bg-zinc-800/50 text-zinc-400 font-mono border border-zinc-700/20 text-[9px]">
                {data.surfaceId.length > 20 ? data.surfaceId.slice(0, 8) + '…' + data.surfaceId.slice(-8) : data.surfaceId}
              </code>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-600 font-bold uppercase tracking-wider">Component</span>
              <code className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-mono border border-indigo-500/15 text-[9px]">
                {data.componentName}
              </code>
            </div>
          </div>

          {/* Error message */}
          {data.error && (
            <CollapsibleCode
              label="Error"
              content={data.error}
              icon={<AlertTriangle size={11} className="text-red-400" />}
              defaultOpen={true}
              bgColor="bg-red-500/5"
              textColor="text-red-400/80"
              borderColor="border-red-500/15"
            />
          )}

          {/* Source code */}
          {data.source && data.source !== '(source unavailable)' && (
            <CollapsibleCode
              label="Source Code"
              content={data.source}
              icon={<Code2 size={11} className="text-blue-400" />}
              defaultOpen={false}
              bgColor="bg-blue-500/5"
              textColor="text-blue-300/70"
              borderColor="border-blue-500/15"
            />
          )}

          {/* Instructions */}
          {data.instructions && (
            <CollapsibleCode
              label="Instructions"
              content={data.instructions}
              icon={<Wrench size={11} className="text-amber-400" />}
              defaultOpen={false}
              bgColor="bg-amber-500/5"
              textColor="text-amber-200/70"
              borderColor="border-amber-500/15"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default SurfaceAutoFixBlock;

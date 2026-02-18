import { useState } from 'react';
import { Wrench, ChevronRight, ChevronDown } from 'lucide-react';
import BrowserPreview from './BrowserPreview';

interface ToolCallProps {
  toolName?: string;
  args: unknown;
  result?: unknown;
}

/** Truncate a string to a single line of max `len` characters */
function truncate(value: string, len = 120): string {
  // Collapse whitespace to a single line
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= len) return oneLine;
  return oneLine.slice(0, len) + '…';
}

/** Collapsible section: shows one truncated line; click to expand full content */
const CollapsibleSection: React.FC<{
  label: string;
  content: string;
  labelColor: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}> = ({ label, content, labelColor, bgColor, textColor, borderColor }) => {
  const [expanded, setExpanded] = useState(false);
  const preview = truncate(content);
  const isLong = content.replace(/\s+/g, ' ').trim().length > 120;

  return (
    <div
      className={`flex gap-2 ${isLong ? 'cursor-pointer group/section' : ''}`}
      onClick={() => isLong && setExpanded(e => !e)}
    >
      <span className={`text-[9px] font-bold uppercase w-12 text-right shrink-0 mt-1 tracking-wider ${labelColor}`}>
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {isLong && (
          <span className="inline-block mr-1 text-zinc-600 align-middle transition-transform duration-200">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        {expanded ? (
          <pre className={`text-[11px] font-mono leading-relaxed p-3 rounded-lg border whitespace-pre-wrap break-all transition-all duration-300 animate-fade-in ${bgColor} ${textColor} ${borderColor}`}>
            {content}
          </pre>
        ) : (
          <code className={`text-[11px] font-mono px-2 py-0.5 rounded-md border inline-block max-w-full truncate transition-all duration-200 ${bgColor} ${textColor} ${borderColor} ${isLong ? 'group-hover/section:border-zinc-600/30' : ''}`}>
            {preview}
          </code>
        )}
      </div>
    </div>
  );
};

import React from 'react';

const ToolCall: React.FC<ToolCallProps> = ({ toolName, args, result }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const name = toolName?.toLowerCase() || '';
    return name.includes('write_file') || name.includes('read_file') || name.includes('edit_file') || name.includes('apply_diff');
  });

  const inputStr = typeof args === 'string' ? args : JSON.stringify(args);
  
  let outputStr: string | null = null;
  let browserPreviewData = null;

  if (result !== undefined && result !== null) {
    if (typeof result === 'object') {
        // If it's already an object, check if it's our browser preview
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resObj = result as any;
        if (resObj._type === 'browser_preview') {
            browserPreviewData = resObj;
        }
        outputStr = JSON.stringify(result);
    } else {
        const resStr = String(result);
        outputStr = resStr;
        
        // Try to parse as JSON to see if it's a browser preview string
        try {
            if (resStr.trim().startsWith('{')) {
                const parsed = JSON.parse(resStr);
                if (parsed && parsed._type === 'browser_preview') {
                    browserPreviewData = parsed;
                }
            }
        } catch {
            // Not JSON
        }
    }
  }

  return (
    <div className="w-full bg-[#0a0a0a] border border-zinc-800/30 rounded-xl overflow-hidden shadow-lg shadow-black/10 my-2 transition-all duration-300 hover:border-zinc-700/40 animate-fade-in-up">
      <div 
        className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/30 border-b border-zinc-800/20 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="p-1 rounded-md bg-amber-500/10">
          <Wrench size={12} className="text-amber-500" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 flex-1">
          {toolName}
        </span>
        <span className="text-zinc-600 transition-transform duration-200">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      
      {!isCollapsed && (
        <div className="p-4 space-y-3 animate-fade-in">
          <CollapsibleSection
            label="Input"
            content={inputStr}
            labelColor="text-zinc-600"
            bgColor="bg-amber-500/5"
            textColor="text-amber-200/80"
            borderColor="border-amber-500/10"
          />
          
          {browserPreviewData ? (
              <div className="mt-4 animate-fade-in">
                  <BrowserPreview 
                      url={browserPreviewData.url} 
                      title={browserPreviewData.title}
                      screenshot={browserPreviewData.screenshot}
                      logs={browserPreviewData.logs || []}
                      networkLogs={browserPreviewData.networkLogs || []}
                      error={browserPreviewData.error}
                      lastAction={browserPreviewData.lastAction}
                  />
              </div>
          ) : (
              outputStr !== null && (
              <CollapsibleSection
                  label="Output"
                  content={outputStr}
                  labelColor="text-zinc-600"
                  bgColor="bg-emerald-500/5"
                  textColor="text-emerald-400"
                  borderColor="border-emerald-500/10"
              />
              )
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCall;

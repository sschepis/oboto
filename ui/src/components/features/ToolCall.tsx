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

/** Format JSON for display - pretty print for expanded, inline for collapsed */
function formatJson(value: unknown, pretty = false): string {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch {
      return value;
    }
  }
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/** Get a human-readable summary of tool args/results */
function getSummary(toolName: string | undefined, data: unknown, isResult: boolean): string {
  if (!data) return '';
  
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (!obj || typeof obj !== 'object') return truncate(String(data), 60);
    
    const name = toolName?.toLowerCase() || '';
    
    // Handle results
    if (isResult) {
      if (obj.error) return `❌ ${obj.error}`;
      if (obj.success === true) return '✓ Success';
      if (obj.count !== undefined) return `${obj.count} items`;
      if (obj.files && Array.isArray(obj.files)) return `${obj.files.length} files`;
      if (obj.tasks && Array.isArray(obj.tasks)) return `${obj.tasks.length} tasks`;
      if (obj.content) return truncate(obj.content, 80);
      if (obj.summary) return truncate(obj.summary, 80);
      
      // Default: show first few keys
      const keys = Object.keys(obj);
      if (keys.length > 0) return keys.slice(0, 3).join(', ');
    }
    
    // Handle args
    if (name.includes('file')) {
      if (obj.file_path) return `📄 ${obj.file_path}`;
      if (obj.path) return `📄 ${obj.path}`;
      if (obj.files && Array.isArray(obj.files)) return `📄 ${obj.files.length} files`;
    }
    if (name.includes('search') && obj.query) return `🔍 "${truncate(obj.query, 40)}"`;
    if (name.includes('task') && obj.task_id) return `🎯 ${obj.task_id}`;
    if (name.includes('browser') && obj.url) return `🌐 ${obj.url}`;
    
    // Default: show key=value pairs for small objects
    const pairs = Object.entries(obj)
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${truncate(String(v), 30)}`)
      .join(', ');
    return pairs || '';
  } catch {
    return truncate(String(data), 60);
  }
}

/** Collapsible section: shows one truncated line; click to expand full content */
const CollapsibleSection: React.FC<{
  label: string;
  content: unknown;
  summary?: string;
  labelColor: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}> = ({ label, content, summary, labelColor, bgColor, textColor, borderColor }) => {
  const [expanded, setExpanded] = useState(false);
  
  // Format for display
  const prettyContent = formatJson(content, true);
  const inlineContent = formatJson(content, false);
  const preview = summary || truncate(inlineContent, 100);
  const isLong = inlineContent.length > 100;

  return (
    <div className="flex gap-2">
      <span className={`text-[9px] font-bold uppercase w-14 text-right shrink-0 pt-1.5 tracking-wider ${labelColor}`}>
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {/* Header bar with summary - always visible */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${bgColor} border ${borderColor} ${isLong ? 'hover:border-zinc-500/30' : ''}`}
          onClick={() => isLong && setExpanded(e => !e)}
        >
          {isLong && (
            <span className="text-zinc-500 shrink-0 transition-transform duration-200">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}
          <span className={`text-[11px] font-medium ${textColor} truncate`}>
            {preview}
          </span>
        </div>
        
        {/* Expanded JSON view */}
        {expanded && (
          <pre className={`mt-1.5 text-[11px] font-mono leading-relaxed p-3 rounded-lg border whitespace-pre-wrap break-words transition-all duration-300 animate-fade-in overflow-auto max-h-80 ${bgColor} ${textColor} ${borderColor}`}>
            {prettyContent}
          </pre>
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

  // Generate summaries for quick preview
  const argsSummary = getSummary(toolName, args, false);
  const resultSummary = result !== undefined && result !== null ? getSummary(toolName, result, true) : null;
  
  let browserPreviewData = null;

  if (result !== undefined && result !== null) {
    if (typeof result === 'object') {
        // If it's already an object, check if it's our browser preview
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resObj = result as any;
        if (resObj._type === 'browser_preview') {
            browserPreviewData = resObj;
        }
    } else {
        const resStr = String(result);
        
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
            content={args}
            summary={argsSummary}
            labelColor="text-zinc-500"
            bgColor="bg-amber-500/5"
            textColor="text-amber-200/90"
            borderColor="border-amber-500/15"
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
              result !== undefined && result !== null && (
              <CollapsibleSection
                  label="Output"
                  content={result}
                  summary={resultSummary || undefined}
                  labelColor="text-zinc-500"
                  bgColor="bg-emerald-500/5"
                  textColor="text-emerald-400"
                  borderColor="border-emerald-500/15"
              />
              )
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCall;

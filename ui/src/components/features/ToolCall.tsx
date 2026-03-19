import React, { useState } from 'react';
import { Wrench, ChevronRight, ChevronDown } from 'lucide-react';
import BrowserPreview from './BrowserPreview';
import TerminalToolCall from './TerminalToolCall';
import EmbeddedObject from './EmbeddedObject';
import MarkdownRenderer from '../chat/MarkdownRenderer';

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

/**
 * Known visualization code-fence languages that should be rendered as rich
 * widgets via MarkdownRenderer instead of plain text.
 */
const VIZ_FENCE_LANGUAGES = ['canvasviz', 'tradingchart', 'mathanim', 'chart', 'json:chart'];

/** Check if a tool result string contains a visualization code fence */
function containsVizCodeFence(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return VIZ_FENCE_LANGUAGES.some(lang => text.includes('```' + lang));
}

const VALID_EMBED_TYPES = ['youtube', 'video', 'audio', 'iframe', 'map', 'tweet', 'codepen', 'spotify', 'figma', 'gist', 'loom', 'generic'] as const;
type EmbedType = typeof VALID_EMBED_TYPES[number];

/** Parse embed_object tool args into an EmbeddedObject shape for inline rendering */
function parseEmbedArgs(args: unknown): { embedType: EmbedType; url: string; title?: string; description?: string; thumbnailUrl?: string; startTime?: number; autoplay?: boolean; width?: string; height?: string } | null {
  if (!args) return null;
  try {
    const obj = typeof args === 'string' ? JSON.parse(args) : args;
    if (!obj || typeof obj !== 'object') return null;
    const a = obj as Record<string, unknown>;
    const embedType = a.embed_type as string;
    const url = a.url as string;
    if (!embedType || !url) return null;
    if (!VALID_EMBED_TYPES.includes(embedType as EmbedType)) return null;
    return {
      embedType: embedType as EmbedType,
      url,
      title: a.title as string | undefined,
      description: a.description as string | undefined,
      thumbnailUrl: a.thumbnail_url as string | undefined,
      startTime: a.start_time as number | undefined,
      autoplay: a.autoplay as boolean | undefined,
      width: a.width as string | undefined,
      height: a.height as string | undefined,
    };
  } catch { return null; }
}

const ToolCall: React.FC<ToolCallProps> = ({ toolName, args, result }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const name = toolName?.toLowerCase() || '';
    return name.includes('write_file') || name.includes('read_file') || name.includes('edit_file') || name.includes('apply_diff');
  });
  const [resultExpanded, setResultExpanded] = useState(false);
  const [argsExpanded, setArgsExpanded] = useState(false);

  // Render run_command as an inline terminal — checked after hooks
  // to satisfy Rules of Hooks, but before heavier parsing below.
  const isRunCommand = toolName?.toLowerCase() === 'run_command';
  if (isRunCommand) {
    return <TerminalToolCall args={args} result={result} />;
  }

  // Render embed_object as an inline embedded media player (YouTube, Spotify, etc.)
  const isEmbed = toolName?.toLowerCase() === 'embed_object';
  if (isEmbed) {
    const embedData = parseEmbedArgs(args);
    if (embedData) {
      return <EmbeddedObject embed={embedData} />;
    }
  }

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

  // Format output for full-width display
  const resultPretty = result !== undefined && result !== null ? formatJson(result, true) : '';
  const resultInline = result !== undefined && result !== null ? formatJson(result, false) : '';
  const resultPreview = resultSummary || truncate(resultInline, 120);
  const resultIsLong = resultInline.length > 120;

  return (
    <div className="w-full bg-[#0a0a0a] border border-zinc-800/30 rounded-xl overflow-hidden shadow-lg shadow-black/10 my-2 transition-all duration-300 hover:border-zinc-700/40 animate-fade-in-up">
      <div
        className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/30 border-b border-zinc-800/20 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="p-1 rounded-md bg-amber-500/10">
          <Wrench size={12} className="text-amber-500" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 shrink-0">
          {toolName}
        </span>
        {argsSummary && (
          <span
            className={`text-[11px] font-medium text-amber-200/90 bg-amber-500/5 border border-amber-500/15 px-2.5 py-0.5 rounded-lg truncate min-w-0 cursor-pointer hover:bg-amber-500/10 hover:border-amber-500/30 transition-colors ${argsExpanded && !isCollapsed ? 'ring-1 ring-amber-500/30' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isCollapsed) {
                setArgsExpanded(prev => !prev);
              } else {
                // If collapsed, expand panel and show args
                setIsCollapsed(false);
                setArgsExpanded(true);
              }
            }}
          >
            {argsSummary}
          </span>
        )}
        <span className="ml-auto text-zinc-600 transition-transform duration-200 shrink-0">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      
      {!isCollapsed && (
        <div className="animate-fade-in">
          {/* Expanded input parameters block */}
          {argsExpanded && (
            <div className="px-4 pt-3 pb-1">
              <pre className="text-[11px] font-mono leading-relaxed p-3 rounded-lg border whitespace-pre-wrap break-words transition-all duration-300 animate-fade-in overflow-auto max-h-80 bg-amber-500/5 text-amber-200/90 border-amber-500/15">
                {formatJson(args, true)}
              </pre>
            </div>
          )}
          {browserPreviewData ? (
              <div className="p-4 animate-fade-in">
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
              <div className="w-full">
                {/* Visualization code fences → render inline via MarkdownRenderer */}
                {containsVizCodeFence(resultInline) ? (
                  <div className="p-4">
                    <MarkdownRenderer content={resultInline} />
                  </div>
                ) : (
                  <>
                    {/* Output summary bar */}
                    <div
                      className={`flex items-center gap-2 px-4 py-2.5 w-full ${resultIsLong ? 'cursor-pointer hover:bg-emerald-500/5' : ''} transition-colors`}
                      onClick={() => resultIsLong && setResultExpanded(e => !e)}
                    >
                      {resultIsLong && (
                        <span className="text-zinc-500 shrink-0 transition-transform duration-200">
                          {resultExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-emerald-400 truncate">
                        {resultPreview}
                      </span>
                    </div>
                    
                    {/* Expanded output view */}
                    {resultExpanded && (
                      <pre className="mx-4 mb-4 text-[11px] font-mono leading-relaxed p-3 rounded-lg border whitespace-pre-wrap break-words transition-all duration-300 animate-fade-in overflow-auto max-h-80 bg-emerald-500/5 text-emerald-400 border-emerald-500/15">
                        {resultPretty}
                      </pre>
                    )}
                  </>
                )}
              </div>
              )
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCall;

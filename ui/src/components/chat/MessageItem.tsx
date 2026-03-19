import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Terminal, Copy, Trash2, RefreshCw, Pencil, Check, X, Loader2, ListChecks, CheckCircle2, XCircle, CircleDashed, SkipForward, Loader, Coins, Paperclip, FileText, Image as ImageIcon, FileCode, FileSpreadsheet, File } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ToolCall from '../features/ToolCall';
import NeuralVisualization from '../features/NeuralVisualization';
import HtmlSandbox from '../features/HtmlSandbox';
import DecisionSurvey from '../features/DecisionSurvey';
import ThinkingStream from '../features/ThinkingStream';
import ApprovalBlock from '../features/ApprovalBlock';
import BackgroundSubstrate from '../features/BackgroundSubstrate';
import AgentOrchestrator from '../features/AgentOrchestrator';
import CodeDiff from '../features/CodeDiff';
import TelemetryGraph from '../features/TelemetryGraph';
import SearchSubstrate from '../features/SearchSubstrate';
import InteractiveTerminal from '../features/InteractiveTerminal';
import SecretVaultBlock from '../features/SecretVaultBlock';
import TestResultsPanel from '../features/TestResultsPanel';
import BrowserPreview from '../features/BrowserPreview';
import EmbeddedObject from '../features/EmbeddedObject';
import SurfaceAutoFixBlock from '../features/SurfaceAutoFixBlock';
import { wsService } from '../../services/wsService';
import { resolveBackendUrl } from '../../utils/resolveBackendUrl';
import type { Message } from '../../types';

export interface MessageActions {
  onCopy: (message: Message) => void;
  onDelete: (id: string) => void;
  /** User-only: rerun the same user message */
  onRerun?: (id: string) => void;
  /** User-only: edit message text and rerun */
  onEditAndRerun?: (id: string, newContent: string) => void;
  /** AI-only: regenerate (re-send the preceding user prompt) */
  onRegenerate?: (id: string) => void;
}

interface MessageItemProps {
  message: Message;
  actions?: MessageActions;
  /** Label shown for user messages (defaults to "You") */
  userLabel?: string;
  /** Label shown for agent messages (defaults to "Nexus") */
  agentLabel?: string;
}

/** Small icon button used in the action toolbar */
const ActionBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}> = ({ icon, label, onClick, variant = 'default' }) => (
  <button
    onClick={onClick}
    title={label}
    className={`
      p-1.5 rounded-lg transition-all duration-200 active:scale-90
      ${variant === 'danger'
        ? 'hover:bg-red-500/10 hover:text-red-400 text-zinc-600'
        : 'hover:bg-zinc-700/40 hover:text-zinc-200 text-zinc-600'}
    `}
  >
    {icon}
  </button>
);

/** Get a file-type icon for an attachment based on its extension */
function getAttachmentIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return <FileText size={14} className="text-red-400" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return <ImageIcon size={14} className="text-emerald-400" />;
  if (['js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'sh', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) return <FileCode size={14} className="text-blue-400" />;
  if (['csv', 'xls', 'xlsx', 'tsv'].includes(ext)) return <FileSpreadsheet size={14} className="text-green-400" />;
  return <File size={14} className="text-zinc-400" />;
}

/** Parse <tool_call> XML blocks from message content, returning extracted calls and cleaned text */
interface ParsedToolCall {
  name: string;
  args: unknown;
}

function extractToolCalls(content: string): { toolCalls: ParsedToolCall[]; cleanContent: string } {
  const toolCalls: ParsedToolCall[] = [];
  // Match <tool_call> ... </tool_call> blocks (greedy-safe via lazy .*?)
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let cleanContent = content;
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      toolCalls.push({
        name: parsed.name || 'unknown',
        args: parsed.arguments ?? parsed.args ?? {},
      });
    } catch {
      // Not valid JSON — try as-is so we still show something
      toolCalls.push({ name: 'unknown', args: { raw } });
    }
  }

  if (toolCalls.length > 0) {
    cleanContent = content.replace(toolCallRegex, '').trim();
  }

  // Strip <tool_result>...</tool_result> blocks that the AI model sometimes echoes
  // back in its text response.  These contain raw tool output (e.g. full JSX source
  // code) and should never be rendered as visible message text — the structured
  // ToolCall component already displays tool results.
  cleanContent = cleanContent.replace(/<tool_result>\s*[\s\S]*?\s*<\/tool_result>/g, '').trim();

  return { toolCalls, cleanContent };
}

/** Parse user message content and render [attached: filename] tags as styled chips */
function renderUserContentWithAttachments(content: string) {
  const attachRegex = /\[attached:\s*(.+?)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = attachRegex.exec(content)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>);
    }
    const filename = match[1].trim();
    parts.push(
      <span
        key={`a-${match.index}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-[12px] font-medium text-zinc-100/90 mx-0.5 my-0.5 align-middle"
        title={`Attached file: ${filename}`}
      >
        <Paperclip size={11} className="text-zinc-100/60" />
        {getAttachmentIcon(filename)}
        {filename}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last match
  if (lastIndex < content.length) {
    parts.push(<span key={`t-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }

  // No attachments found — return plain text
  if (parts.length === 0) return <span className="whitespace-pre-wrap">{content}</span>;

  return <span className="whitespace-pre-wrap">{parts}</span>;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, actions, userLabel = 'You', agentLabel = 'Nexus' }) => {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [copied, setCopied] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus and auto-size edit textarea
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [editing]);

  const handleCopy = useCallback(() => {
    if (!actions) return;
    actions.onCopy(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [actions, message]);

  const handleDelete = useCallback(() => {
    actions?.onDelete(message.id);
  }, [actions, message.id]);

  const handleRegenerate = useCallback(() => {
    actions?.onRegenerate?.(message.id);
  }, [actions, message.id]);

  const startEdit = useCallback(() => {
    setEditText(message.content || '');
    setEditing(true);
  }, [message.content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditText(message.content || '');
  }, [message.content]);

  const confirmEdit = useCallback(() => {
    if (!editText.trim()) return;
    setEditing(false);
    actions?.onEditAndRerun?.(message.id, editText.trim());
  }, [actions, message.id, editText]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }, [confirmEdit, cancelEdit]);

  // Determine if this message type supports text actions (copy/edit)
  const hasTextContent = message.type === 'text' && !!message.content;

  // Check if this is a Surface Auto-Fix Request (system-generated user message)
  const isAutoFixRequest = isUser && message.type === 'text' && !!message.content
    && message.content.trimStart().startsWith('[Surface Auto-Fix Request]');
  
  return (
    <div className={`group flex w-full gap-4 animate-fade-in-up ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-800 flex-shrink-0 flex items-center justify-center border border-zinc-700/30 shadow-lg shadow-black/20 self-start mt-1 transition-transform duration-300 group-hover:scale-105">
          <Bot size={18} className="text-indigo-400" />
        </div>
      )}
      
      <div className={`max-w-[85%] space-y-3 ${isUser ? 'items-end flex flex-col' : ''}`}>
        <div className="flex items-center gap-3 px-1">
          <span className={`text-[9px] font-black uppercase tracking-[0.15em] ${isAutoFixRequest ? 'text-amber-600' : 'text-zinc-600'}`}>
            {isAutoFixRequest ? 'Auto-Fix' : isUser ? userLabel : agentLabel}
          </span>
          <span className="text-[9px] text-zinc-700/60 font-mono">{message.timestamp}</span>
          {!isUser && message.tokenUsage?.totalTokens && (
            <span
              className="flex items-center gap-1 text-[9px] text-zinc-700/50 font-mono"
              title={[
                message.tokenUsage.promptTokens != null && `Prompt: ${message.tokenUsage.promptTokens.toLocaleString()}`,
                message.tokenUsage.completionTokens != null && `Completion: ${message.tokenUsage.completionTokens.toLocaleString()}`,
                `Total: ${message.tokenUsage.totalTokens.toLocaleString()}`,
              ].filter(Boolean).join(' · ')}
            >
              <Coins size={9} />
              {message.tokenUsage.totalTokens.toLocaleString()}
            </span>
          )}
        </div>
        
        {!isUser && message.thoughts && <ThinkingStream thoughts={message.thoughts} />}

        {/* Surface Auto-Fix Request — formatted card instead of raw text */}
        {message.type === 'text' && !editing && isAutoFixRequest && (
          <SurfaceAutoFixBlock content={message.content!} />
        )}

        {/* Text messages — rendered as Markdown */}
        {message.type === 'text' && !editing && !isAutoFixRequest && (
          <div
            className={`
              p-5 rounded-2xl leading-relaxed text-[14px] border
              transition-all duration-300
              ${isUser
                ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm border-indigo-500/30 shadow-lg shadow-indigo-500/10'
                  + (actions?.onEditAndRerun ? ' cursor-pointer hover:from-indigo-500 hover:to-indigo-600' : '')
                : 'bg-[#111111] text-zinc-200 rounded-tl-sm border-zinc-800/40 shadow-lg shadow-black/20 hover:border-zinc-700/50'}
            `}
            {...(isUser && actions?.onEditAndRerun ? { onClick: startEdit, title: 'Click to edit' } : {})}
          >
            {isUser ? (
              renderUserContentWithAttachments(message.content || '')
            ) : (
              <div className="space-y-4">
                {/* Render tool calls FIRST (above text content) */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 mb-2">
                      <Terminal size={10} /> Tool Calls
                    </div>
                    {message.toolCalls.map((tc, idx) => (
                      <ToolCall
                        key={idx}
                        toolName={tc.toolName}
                        args={tc.args}
                        result={tc.result}
                      />
                    ))}
                  </div>
                )}
                
                {/* Pending indicator while waiting for response text (non-streaming) */}
                {message._pending && !message._streaming && (!message.content || message.content.trim() === '') && (
                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/30">
                    <Loader2 size={14} className="animate-spin text-indigo-400" />
                    <span className="text-[12px] text-zinc-500">Working...</span>
                  </div>
                )}

                {/* Streaming cursor when content hasn't arrived yet */}
                {message._streaming && (!message.content || message.content.trim() === '') && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="inline-block w-2 h-4 bg-indigo-400 rounded-sm animate-pulse" />
                  </div>
                )}

                {/* Then render the text content (with inline <tool_call> tags extracted) */}
                {message.content && message.content.trim() !== '' && (() => {
                  const { toolCalls: inlineToolCalls, cleanContent } = extractToolCalls(message.content);
                  const hasExistingToolCalls = (message.toolCalls && message.toolCalls.length > 0) || inlineToolCalls.length > 0;
                  return (
                    <>
                      {/* Render inline tool calls extracted from content text */}
                      {inlineToolCalls.length > 0 && (
                        <div className="space-y-2">
                          {!(message.toolCalls && message.toolCalls.length > 0) && (
                            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 mb-2">
                              <Terminal size={10} /> Tool Calls
                            </div>
                          )}
                          {inlineToolCalls.map((tc, idx) => (
                            <ToolCall
                              key={`inline-tc-${idx}`}
                              toolName={tc.name}
                              args={tc.args}
                            />
                          ))}
                        </div>
                      )}
                      {cleanContent && cleanContent.trim() !== '' && (
                        <>
                          {hasExistingToolCalls && (
                            <div className="border-t border-zinc-800/30" />
                          )}
                          <MarkdownRenderer content={cleanContent} />
                        </>
                      )}
                      {/* Streaming cursor — shown while LLM tokens are arriving */}
                      {message._streaming && (
                        <span className="inline-block w-2 h-4 ml-0.5 bg-indigo-400 rounded-sm animate-pulse align-middle" />
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Inline edit mode for user text messages */}
        {message.type === 'text' && editing && isUser && (
          <div className="w-full bg-[#111111] border border-indigo-500/30 rounded-2xl p-4 space-y-3 shadow-lg shadow-indigo-500/5 animate-scale-in">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={handleEditKeyDown}
              className="w-full bg-transparent text-zinc-200 text-[14px] resize-none outline-none min-h-[44px] leading-relaxed"
              rows={1}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={cancelEdit}
                className="
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                  text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60
                  transition-all duration-200 active:scale-95
                "
              >
                <X size={12} /> Cancel
              </button>
              <button
                onClick={confirmEdit}
                className="
                  flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold
                  text-white bg-indigo-600 hover:bg-indigo-500
                  transition-all duration-200 active:scale-95
                  shadow-md shadow-indigo-500/20
                "
              >
                <Check size={12} /> Save & Rerun
              </button>
            </div>
          </div>
        )}

        {/* Search results */}
        {message.type === 'search' && (
           <SearchSubstrate query={message.query || ''} results={message.results || []} />
        )}

        {/* Terminal output */}
        {message.type === 'terminal' && (
           <InteractiveTerminal initialOutput={message.output || []} />
        )}

        {/* Approval requests */}
        {message.type === 'approval' && (
           <ApprovalBlock action={message.action || ''} description={message.description || ''} />
        )}

        {/* Secret vault */}
        {message.type === 'secret-request' && (
           <SecretVaultBlock secretLabel={message.label || 'Secret'} />
        )}

        {/* Test results */}
        {message.type === 'test-results' && message.testResults && (
           <TestResultsPanel
             testResults={message.testResults}
             onRerun={() => wsService.runTests(message.testResults?.testCommand)}
           />
        )}

        {/* Browser Preview */}
        {message.type === 'browser-preview' && message.browserPreview && (
           <BrowserPreview
             url={message.browserPreview.url}
             title={message.browserPreview.title}
             screenshot={message.browserPreview.screenshot}
             logs={message.browserPreview.logs || []}
           />
        )}

        {/* Embedded objects (YouTube, Spotify, etc.) */}
        {message.type === 'embed' && message.embed && (
           <EmbeddedObject embed={message.embed} />
        )}

        {/* Background tasks */}
        {message.type === 'background-tasks' && (
           <BackgroundSubstrate tasks={message.tasks || []} />
        )}

        {/* Task plan (structured task decomposition) */}
        {message.type === 'task-plan' && message.steps && (
          <div className="w-full bg-[#111111] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
            <div className="px-5 py-3 border-b border-zinc-800/30 bg-zinc-900/20 flex items-center gap-2">
              <ListChecks size={14} className="text-indigo-400" />
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-300">
                {message.title || 'Task Plan'}
              </span>
              {message.planStatus && (
                <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  message.planStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400'
                  : message.planStatus === 'failed' ? 'bg-red-500/10 text-red-400'
                  : message.planStatus === 'cancelled' ? 'bg-amber-500/10 text-amber-400'
                  : message.planStatus === 'executing' ? 'bg-indigo-500/10 text-indigo-400'
                  : 'bg-zinc-500/10 text-zinc-500'
                }`}>
                  {message.planStatus}
                </span>
              )}
            </div>
            <div className="divide-y divide-zinc-800/20">
              {message.steps.map((step, idx) => {
                const icon = step.status === 'done'
                  ? <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  : step.status === 'failed'
                  ? <XCircle size={14} className="text-red-400 flex-shrink-0" />
                  : step.status === 'running'
                  ? <Loader size={14} className="text-indigo-400 animate-spin flex-shrink-0" />
                  : step.status === 'skipped'
                  ? <SkipForward size={14} className="text-zinc-600 flex-shrink-0" />
                  : <CircleDashed size={14} className="text-zinc-600 flex-shrink-0" />;

                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors duration-150 ${
                      step.status === 'running' ? 'bg-indigo-500/5' : 'hover:bg-zinc-800/10'
                    }`}
                  >
                    {icon}
                    <span className={`text-[13px] ${
                      step.status === 'done' ? 'text-zinc-300'
                      : step.status === 'failed' ? 'text-red-300'
                      : step.status === 'running' ? 'text-indigo-300 font-medium'
                      : step.status === 'skipped' ? 'text-zinc-600 line-through'
                      : 'text-zinc-500'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Pending indicator while plan is still executing */}
            {message._pending && (
              <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-800/30">
                <Loader2 size={14} className="animate-spin text-indigo-400" />
                <span className="text-[12px] text-zinc-500">Executing plan…</span>
              </div>
            )}
          </div>
        )}

        {/* Agent handoff */}
        {message.type === 'agent-handoff' && (
           <AgentOrchestrator from={message.from || ''} to={message.to || ''} task={message.task || ''} />
        )}

        {/* Code diffs */}
        {message.type === 'code-diff' && (
           <CodeDiff filename={message.filename || ''} oldCode={message.oldCode || ''} newCode={message.newCode || ''} />
        )}

        {/* Telemetry */}
        {message.type === 'telemetry' && (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full animate-fade-in-up">
             <TelemetryGraph label="Neural Latency" />
             <TelemetryGraph label="Resource Heat" color="emerald" />
           </div>
        )}
        
        {/* Images */}
        {message.type === 'image' && (
          <div className="w-full bg-[#111111] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
            <img src={resolveBackendUrl(message.url)} className="w-full h-auto max-h-[400px] object-cover" alt={message.caption} />
            <p className="p-4 text-xs italic text-zinc-500">{message.caption}</p>
          </div>
        )}
        
        {/* Tables */}
        {message.type === 'table' && (
          <div className="w-full bg-[#111111] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20">
            <div className="px-5 py-3 border-b border-zinc-800/30 bg-zinc-900/20 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
              {message.title}
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-900/30">
                  {message.headers?.map((h, i) => (
                    <th key={i} className="px-5 py-3 font-bold text-zinc-500 border-b border-zinc-800/30 text-[10px] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/20">
                {message.rows?.map((row, i) => (
                  <tr key={i} className="hover:bg-zinc-800/10 transition-colors duration-150">
                    {row.map((c, j) => (
                      <td key={j} className="px-5 py-3 text-zinc-400 font-mono">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Log output */}
        {message.type === 'log' && (
          <div className="w-full bg-[#050505] border border-zinc-800/40 rounded-2xl overflow-hidden p-5 font-mono text-[11px] text-emerald-500/80 leading-relaxed shadow-lg shadow-black/20">
            <pre className="whitespace-pre-wrap">{message.content}</pre>
          </div>
        )}
        
        {/* Tool calls */}
        {message.type === 'tool-call' && (
          <ToolCall toolName={message.toolName} args={message.args} result={message.result} />
        )}
        
        {/* Visualization */}
        {message.type === 'visualization' && <NeuralVisualization />}
        
        {/* HTML sandbox */}
        {message.type === 'html-sandbox' && <HtmlSandbox code={message.code} />}
        
        {/* Survey */}
        {message.type === 'survey' && (
          <DecisionSurvey question={message.question} options={message.options} />
        )}
        

        {/* ── Message Action Toolbar ── */}
        {actions && !editing && (
          <div className={`
            flex items-center gap-0.5 px-1
            opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0
            transition-all duration-200
            ${isUser ? 'justify-end' : 'justify-start'}
          `}>
            {/* Copy — for text messages */}
            {hasTextContent && (
              <ActionBtn
                icon={copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                label={copied ? 'Copied!' : 'Copy message'}
                onClick={handleCopy}
              />
            )}

            {/* User-only: Edit & Rerun */}
            {isUser && hasTextContent && actions.onEditAndRerun && (
              <ActionBtn
                icon={<Pencil size={13} />}
                label="Edit & rerun"
                onClick={startEdit}
              />
            )}

            {/* AI-only: Regenerate */}
            {!isUser && actions.onRegenerate && (
              <ActionBtn
                icon={<RefreshCw size={13} />}
                label="Regenerate"
                onClick={handleRegenerate}
              />
            )}

            {/* Delete — for all messages */}
            <ActionBtn
              icon={<Trash2 size={13} />}
              label="Delete message"
              onClick={handleDelete}
              variant="danger"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageItem;

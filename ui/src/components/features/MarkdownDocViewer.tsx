import React, { useEffect, useState, useRef, useCallback, memo, forwardRef, useImperativeHandle } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import mermaid from 'mermaid';
import Editor, { type OnMount } from '@monaco-editor/react';
import { wsService } from '../../services/wsService';
import {
  Eye, Pencil, Save, Loader2, Copy, Check,
  BookOpen, ChevronRight, Hash, ChevronDown
} from 'lucide-react';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#0a0a0a',
    primaryColor: '#6366f1',
    primaryTextColor: '#e4e4e7',
    primaryBorderColor: '#4f46e5',
    lineColor: '#52525b',
    secondaryColor: '#1e1b4b',
    tertiaryColor: '#18181b',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    fontSize: '13px',
    noteBkgColor: '#1e1b4b',
    noteTextColor: '#c7d2fe',
    noteBorderColor: '#4338ca',
  },
  flowchart: { curve: 'basis', padding: 20 },
  sequence: { mirrorActors: false },
});

/**
 * Mermaid diagram component — renders mermaid code blocks as SVG diagrams.
 */
const MermaidDiagram: React.FC<{ code: string }> = memo(({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(id, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setSvg('');
        }
        // Clean up any orphaned mermaid elements
        const orphan = document.getElementById(`d${id}`);
        orphan?.remove();
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <div className="text-red-400 text-xs font-mono mb-2">Mermaid diagram error:</div>
        <div className="text-red-300/60 text-xs font-mono whitespace-pre-wrap">{error}</div>
        <pre className="mt-3 text-zinc-500 text-xs font-mono overflow-x-auto">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-5 flex justify-center rounded-xl border border-zinc-800/30 bg-zinc-950/50 p-6 overflow-x-auto shadow-lg shadow-black/10 transition-all duration-300 hover:border-indigo-500/20"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
MermaidDiagram.displayName = 'MermaidDiagram';

/**
 * Copy button for code blocks.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md transition-all duration-200 hover:bg-zinc-700/40 active:scale-90"
      title="Copy code"
    >
      {copied ? (
        <Check size={12} className="text-emerald-400" />
      ) : (
        <Copy size={12} className="text-zinc-500 hover:text-zinc-300" />
      )}
    </button>
  );
}

/**
 * Table of contents extracted from markdown headings.
 */
interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[`*_~\[\]]/g, '');
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      entries.push({ level, text, id });
    }
  }
  return entries;
}

/**
 * Table of contents sidebar component.
 */
const TableOfContents: React.FC<{ entries: TocEntry[]; onNavigate: (id: string) => void }> = memo(({ entries, onNavigate }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="w-56 flex-shrink-0 border-r border-zinc-800/30 bg-zinc-950/30 overflow-y-auto">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-wider hover:text-zinc-200 transition-colors border-b border-zinc-800/20"
      >
        <BookOpen size={12} />
        <span>Contents</span>
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed && (
        <nav className="py-2">
          {entries.map((entry, i) => (
            <button
              key={`${entry.id}-${i}`}
              onClick={() => onNavigate(entry.id)}
              className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-xs text-zinc-500 hover:text-indigo-300 hover:bg-indigo-500/5 transition-all duration-150 group"
              style={{ paddingLeft: `${(entry.level - 1) * 12 + 12}px` }}
            >
              {entry.level <= 2 ? (
                <Hash size={10} className="text-indigo-500/40 group-hover:text-indigo-400 flex-shrink-0" />
              ) : (
                <ChevronRight size={8} className="text-zinc-600 group-hover:text-indigo-400 flex-shrink-0" />
              )}
              <span className="truncate">{entry.text}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
});
TableOfContents.displayName = 'TableOfContents';

/**
 * The rendered markdown view — full document-style rendering with
 * GFM, math (KaTeX), mermaid diagrams, and syntax-highlighted code blocks.
 */
const RenderedMarkdown: React.FC<{ content: string }> = memo(({ content }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tocEntries = extractToc(content);

  const handleNavigate = useCallback((id: string) => {
    const el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Generate heading IDs for scroll navigation
  const headingCounter = useRef<Record<string, number>>({});

  // Reset counter on each render
  headingCounter.current = {};

  const makeHeadingId = (text: string) => {
    const raw = typeof text === 'string' ? text : '';
    const base = raw.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    const count = headingCounter.current[base] || 0;
    headingCounter.current[base] = count + 1;
    return count === 0 ? base : `${base}-${count}`;
  };

  const getTextContent = (children: React.ReactNode): string => {
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) return children.map(getTextContent).join('');
    if (children && typeof children === 'object' && 'props' in children) {
      return getTextContent((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
    }
    return '';
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <TableOfContents entries={tocEntries} onNavigate={handleNavigate} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <article className="max-w-4xl mx-auto px-8 py-10 md-doc-article">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              // ─── Code Blocks ───────────────────────────────────────
              code({ className, children, ...props }) {
                const match = /language-([\w:]+)/.exec(className || '');
                const lang = match ? match[1] : '';
                const codeString = String(children).replace(/\n$/, '');
                const isInline = !className && !codeString.includes('\n');

                if (isInline) {
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/10 text-[13px] font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                // Mermaid diagrams
                if (lang === 'mermaid') {
                  return <MermaidDiagram code={codeString} />;
                }

                return (
                  <div className="my-5 rounded-xl bg-[#0a0a0a] border border-zinc-800/30 overflow-hidden shadow-lg shadow-black/10 transition-all duration-300 hover:border-zinc-700/40">
                    <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/40 border-b border-zinc-800/20">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 rounded-full bg-red-500/50" />
                          <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                          <div className="w-2 h-2 rounded-full bg-green-500/50" />
                        </div>
                        <span className="text-[9px] uppercase text-zinc-500 font-bold tracking-[0.15em]">
                          {lang || 'code'}
                        </span>
                      </div>
                      <CopyButton text={codeString} />
                    </div>
                    <SyntaxHighlighter
                      style={oneDark}
                      language={lang || 'text'}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        padding: '1.25rem 1.5rem',
                        background: 'transparent',
                        fontSize: '13px',
                        lineHeight: '1.7',
                      }}
                      codeTagProps={{
                        style: { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  </div>
                );
              },

              pre({ children }) {
                return <>{children}</>;
              },

              // ─── Headings ──────────────────────────────────────────
              h1({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h1 id={id} className="text-3xl font-extrabold text-zinc-50 mt-10 mb-4 pb-3 border-b border-zinc-800/40 leading-tight tracking-tight scroll-mt-6">
                    {children}
                  </h1>
                );
              },
              h2({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h2 id={id} className="text-2xl font-bold text-zinc-100 mt-8 mb-3 pb-2 border-b border-zinc-800/20 leading-snug scroll-mt-6">
                    {children}
                  </h2>
                );
              },
              h3({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h3 id={id} className="text-xl font-bold text-zinc-200 mt-6 mb-2 leading-snug scroll-mt-6">
                    {children}
                  </h3>
                );
              },
              h4({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h4 id={id} className="text-lg font-semibold text-zinc-300 mt-5 mb-2 scroll-mt-6">
                    {children}
                  </h4>
                );
              },
              h5({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h5 id={id} className="text-base font-semibold text-zinc-300 mt-4 mb-1.5 scroll-mt-6">
                    {children}
                  </h5>
                );
              },
              h6({ children }) {
                const text = getTextContent(children);
                const id = makeHeadingId(text);
                return (
                  <h6 id={id} className="text-sm font-semibold text-zinc-400 mt-4 mb-1 scroll-mt-6 uppercase tracking-wide">
                    {children}
                  </h6>
                );
              },

              // ─── Paragraphs ────────────────────────────────────────
              p({ children }) {
                return <p className="mb-4 leading-relaxed text-zinc-300 text-[15px]">{children}</p>;
              },

              // ─── Links ─────────────────────────────────────────────
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-400/60 transition-all duration-200"
                  >
                    {children}
                  </a>
                );
              },

              // ─── Lists ─────────────────────────────────────────────
              ul({ children }) {
                return <ul className="list-disc ml-6 mb-4 space-y-1.5 text-zinc-300 text-[15px] marker:text-indigo-500/40">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal ml-6 mb-4 space-y-1.5 text-zinc-300 text-[15px] marker:text-indigo-400/60">{children}</ol>;
              },
              li({ children }) {
                return <li className="leading-relaxed pl-1">{children}</li>;
              },

              // ─── Blockquotes ───────────────────────────────────────
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-3 border-indigo-500/40 pl-5 my-5 text-zinc-400 italic bg-indigo-500/[0.03] py-3 px-1 rounded-r-xl">
                    {children}
                  </blockquote>
                );
              },

              // ─── Tables ────────────────────────────────────────────
              table({ children }) {
                return (
                  <div className="my-6 overflow-x-auto rounded-xl border border-zinc-800/30 shadow-md shadow-black/10">
                    <table className="w-full text-left text-sm">{children}</table>
                  </div>
                );
              },
              thead({ children }) {
                return <thead className="bg-zinc-900/40">{children}</thead>;
              },
              th({ children }) {
                return (
                  <th className="px-4 py-3 font-bold text-zinc-400 border-b border-zinc-800/30 text-[11px] uppercase tracking-wider">
                    {children}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="px-4 py-2.5 text-zinc-300 border-b border-zinc-800/20 text-[13px]">
                    {children}
                  </td>
                );
              },
              tr({ children }) {
                return <tr className="hover:bg-zinc-800/10 transition-colors">{children}</tr>;
              },

              // ─── Horizontal Rule ───────────────────────────────────
              hr() {
                return (
                  <div className="my-8 flex items-center gap-3">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-700/50" />
                    <div className="w-1 h-1 rounded-full bg-zinc-700/30" />
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-700/50" />
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-700/50 to-transparent" />
                  </div>
                );
              },

              // ─── Inline Formatting ─────────────────────────────────
              strong({ children }) {
                return <strong className="font-semibold text-zinc-100">{children}</strong>;
              },
              em({ children }) {
                return <em className="italic text-zinc-300/90">{children}</em>;
              },
              del({ children }) {
                return <del className="line-through text-zinc-500">{children}</del>;
              },

              // ─── Images ────────────────────────────────────────────
              img({ src, alt }) {
                return (
                  <figure className="my-6 rounded-xl overflow-hidden border border-zinc-800/30 shadow-lg shadow-black/10 bg-zinc-950/50">
                    <img src={src} alt={alt || ''} className="max-w-full h-auto mx-auto" loading="lazy" />
                    {alt && (
                      <figcaption className="px-5 py-2.5 text-[11px] text-zinc-500 italic bg-zinc-900/30 border-t border-zinc-800/20 text-center">
                        {alt}
                      </figcaption>
                    )}
                  </figure>
                );
              },

              // ─── Task Lists ────────────────────────────────────────
              input({ checked, ...props }) {
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className="mr-2 accent-indigo-500 rounded"
                    {...props}
                  />
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
});
RenderedMarkdown.displayName = 'RenderedMarkdown';


// ═══════════════════════════════════════════════════════════════════════
// Main MarkdownDocViewer — wraps FileEditor + RenderedMarkdown with toggle
// ═══════════════════════════════════════════════════════════════════════

export interface MarkdownDocViewerHandle {
  save: () => void;
}

interface MarkdownDocViewerProps {
  filePath: string;
  onDirtyChange?: (filePath: string, isDirty: boolean) => void;
  onSwitchToEditor?: (filePath: string) => void;
}

const MarkdownDocViewer = forwardRef<MarkdownDocViewerHandle, MarkdownDocViewerProps>(
  ({ filePath, onDirtyChange }, ref) => {
    const [content, setContent] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'preview' | 'edit'>('preview');
    const [saving, setSaving] = useState(false);
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
    const savedContentRef = useRef<string>('');
    const completionProviderRef = useRef<{ dispose: () => void } | null>(null);

    // Load file content
    useEffect(() => {
      const unsub = wsService.on('file-content', (payload: unknown) => {
        const p = payload as { path: string; content: string };
        if (p.path === filePath) {
          setContent(p.content);
          savedContentRef.current = p.content;
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
        completionProviderRef.current?.dispose();
      };
    }, [filePath]);

    // Listen for save confirmation
    useEffect(() => {
      const unsub = wsService.on('file-saved', (payload: unknown) => {
        const p = payload as { path: string };
        if (p.path === filePath) {
          setSaving(false);
          if (editorRef.current) {
            const val = editorRef.current.getValue();
            savedContentRef.current = val;
            setContent(val);
          }
          onDirtyChange?.(filePath, false);
        }
      });
      return unsub;
    }, [filePath, onDirtyChange]);

    const handleSave = useCallback(() => {
      if (editorRef.current) {
        setSaving(true);
        const val = editorRef.current.getValue();
        wsService.saveFile(filePath, val);
      }
    }, [filePath]);

    useImperativeHandle(ref, () => ({
      save: handleSave,
    }), [handleSave]);

    const handleEditorMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave);

      completionProviderRef.current?.dispose();
      completionProviderRef.current = monaco.languages.registerInlineCompletionsProvider('markdown', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
          const text = model.getValue();
          const offset = model.getOffsetAt(position);

          const completion = await wsService.requestCompletion({
            filePath,
            language: 'markdown',
            content: text,
            cursorOffset: offset,
            line: position.lineNumber,
            column: position.column,
          });

          if (!completion || token.isCancellationRequested) return { items: [] };

          return {
            items: [{
              insertText: completion,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column + completion.length,
              ),
            }],
          };
        },
        freeInlineCompletions: () => {},
      });
    };

    const handleEditorChange = (value: string | undefined) => {
      if (value !== undefined) {
        onDirtyChange?.(filePath, value !== savedContentRef.current);
        setContent(value);
      }
    };

    // ── Error state ──────────────────────────────────────────────────
    if (error) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-red-400/80 text-xs font-medium animate-fade-in">{error}</div>
        </div>
      );
    }

    // ── Loading state ────────────────────────────────────────────────
    if (content === null) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
          <div className="flex items-center gap-2 text-zinc-600 text-xs animate-fade-in">
            <Loader2 size={14} className="animate-spin text-indigo-400/40" />
            <span className="font-mono">{filePath.split('/').pop()}</span>
          </div>
        </div>
      );
    }

    // ── Main view ────────────────────────────────────────────────────
    const fileName = filePath.split('/').pop() || filePath;
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const lineCount = content.split('\n').length;

    return (
      <div className="flex-1 flex flex-col bg-[#0a0a0a] min-h-0 overflow-hidden">
        {/* ── Toolbar ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50 border-b border-zinc-800/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <BookOpen size={13} className="text-indigo-400/60" />
              <span className="font-medium text-zinc-300">{fileName}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-zinc-600">
              <span>{lineCount} lines</span>
              <span>·</span>
              <span>{wordCount} words</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saving && (
              <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 bg-zinc-900/90 px-2.5 py-1 rounded-lg border border-indigo-500/20 animate-fade-in">
                <Save size={10} className="animate-glow-pulse" /> Saving...
              </div>
            )}

            {/* Mode toggle buttons */}
            <div className="flex items-center bg-zinc-800/40 rounded-lg border border-zinc-700/20 overflow-hidden">
              <button
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  mode === 'preview'
                    ? 'bg-indigo-500/20 text-indigo-300 shadow-inner'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/30'
                }`}
                title="Preview (rendered markdown)"
              >
                <Eye size={12} />
                Preview
              </button>
              <div className="w-px h-4 bg-zinc-700/30" />
              <button
                onClick={() => setMode('edit')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  mode === 'edit'
                    ? 'bg-indigo-500/20 text-indigo-300 shadow-inner'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/30'
                }`}
                title="Edit (raw markdown)"
              >
                <Pencil size={12} />
                Edit
              </button>
            </div>
          </div>
        </div>

        {/* ── Content Area ────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">
          {/* Preview mode */}
          <div
            className={`absolute inset-0 transition-opacity duration-200 ${
              mode === 'preview' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
          >
            <RenderedMarkdown content={content} />
          </div>

          {/* Edit mode */}
          <div
            className={`absolute inset-0 transition-opacity duration-200 ${
              mode === 'edit' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
            }`}
          >
            {mode === 'edit' && (
              <Editor
                height="100%"
                language="markdown"
                value={content}
                theme="vs-dark"
                onMount={handleEditorMount}
                onChange={handleEditorChange}
                options={{
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  wordWrap: 'on',
                  tabSize: 2,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 12, bottom: 12 },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  lineDecorationsWidth: 8,
                  renderWhitespace: 'boundary',
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }
);

MarkdownDocViewer.displayName = 'MarkdownDocViewer';

export default MarkdownDocViewer;

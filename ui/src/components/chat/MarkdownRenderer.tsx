import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import HtmlSandbox from '../features/HtmlSandbox';
import { ChartBlock } from './ChartBlock';
import { Copy, Check } from 'lucide-react';
import { resolveBackendUrl } from '../../utils/resolveBackendUrl';

/**
 * Renders markdown content with:
 * - GFM (tables, strikethrough, autolinks, task lists)
 * - Math support (LaTeX via KaTeX)
 * - Syntax-highlighted code blocks via react-syntax-highlighter
 * - HTML code blocks rendered inline as HtmlSandbox previews
 * - Chart blocks rendered via Recharts
 * - Styled prose for headings, lists, links, etc.
 */

interface MarkdownRendererProps {
  content: string;
}

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
      className="
        p-1.5 rounded-md transition-all duration-200
        hover:bg-zinc-700/40 active:scale-90
      "
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

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // Code blocks
        code({ className, children, ...props }) {
          const match = /language-([\w:]+)/.exec(className || '');
          const lang = match ? match[1] : '';
          const codeString = String(children).replace(/\n$/, '');
          const isInline = !className && !codeString.includes('\n');

          if (isInline) {
            return (
              <code
                className="
                  px-1.5 py-0.5 rounded-md
                  bg-indigo-500/10 text-indigo-300 border border-indigo-500/10
                  text-[13px] font-mono
                "
                {...props}
              >
                {children}
              </code>
            );
          }

          // HTML code blocks → render as live preview
          if (lang === 'html') {
            return (
              <div className="my-4">
                <HtmlSandbox code={codeString} />
              </div>
            );
          }

          // Chart blocks
          if (lang === 'json:chart' || lang === 'chart') {
             return <ChartBlock code={codeString} />;
          }

          return (
            <div className="my-4 rounded-xl bg-[#0a0a0a] border border-zinc-800/30 overflow-hidden shadow-md shadow-black/10 transition-all duration-300 hover:border-zinc-700/40">
              <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/30 border-b border-zinc-800/20">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-zinc-700/60" />
                    <div className="w-2 h-2 rounded-full bg-zinc-700/60" />
                    <div className="w-2 h-2 rounded-full bg-zinc-700/60" />
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
                  padding: '1rem 1.25rem',
                  background: 'transparent',
                  fontSize: '12px',
                  lineHeight: '1.6',
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

        // Pre — just pass through (code handler does the work)
        pre({ children }) {
          return <>{children}</>;
        },

        // Headings
        h1({ children }) {
          return <h1 className="text-xl font-bold text-zinc-100 mt-6 mb-3 border-b border-zinc-800/30 pb-2">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-lg font-bold text-zinc-100 mt-5 mb-2">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-base font-bold text-zinc-200 mt-4 mb-2">{children}</h3>;
        },
        h4({ children }) {
          return <h4 className="text-sm font-bold text-zinc-300 mt-3 mb-1">{children}</h4>;
        },

        // Paragraphs
        p({ children }) {
          return <p className="mb-3 last:mb-0 leading-relaxed text-zinc-300">{children}</p>;
        },

        // Links
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-400/50 transition-all duration-200"
            >
              {children}
            </a>
          );
        },

        // Lists
        ul({ children }) {
          return <ul className="list-disc list-inside mb-3 space-y-1 text-zinc-300">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-3 space-y-1 text-zinc-300">{children}</ol>;
        },
        li({ children }) {
          return <li className="leading-relaxed">{children}</li>;
        },

        // Blockquotes
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-indigo-500/40 pl-4 my-3 text-zinc-400 italic bg-indigo-500/[0.02] py-1 rounded-r-lg">
              {children}
            </blockquote>
          );
        },

        // Tables
        table({ children }) {
          return (
            <div className="my-4 overflow-x-auto rounded-xl border border-zinc-800/30 shadow-sm shadow-black/10">
              <table className="w-full text-left text-xs">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="bg-zinc-900/30">{children}</thead>;
        },
        th({ children }) {
          return <th className="px-4 py-2.5 font-bold text-zinc-400 border-b border-zinc-800/30 text-[10px] uppercase tracking-wider">{children}</th>;
        },
        td({ children }) {
          return <td className="px-4 py-2 text-zinc-300 border-b border-zinc-800/20 font-mono text-[12px]">{children}</td>;
        },

        // Horizontal rule
        hr() {
          return <hr className="my-5 border-zinc-800/30" />;
        },

        // Strong/Bold
        strong({ children }) {
          return <strong className="font-semibold text-zinc-100">{children}</strong>;
        },

        // Emphasis
        em({ children }) {
          return <em className="italic text-zinc-300">{children}</em>;
        },

        // Images — resolve backend URLs for generated images
        img({ src, alt }) {
          const resolvedSrc = resolveBackendUrl(src);
          return (
            <div className="my-4 rounded-xl overflow-hidden border border-zinc-800/30 shadow-md shadow-black/10">
              <img src={resolvedSrc} alt={alt || ''} className="max-w-full h-auto" />
              {alt && <p className="px-4 py-2 text-[10px] text-zinc-500 italic bg-zinc-900/20">{alt}</p>}
            </div>
          );
        },

        // Task lists (via GFM)
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
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;

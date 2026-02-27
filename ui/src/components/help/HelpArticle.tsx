import React from 'react';
import { ArrowLeft, ThumbsUp, ThumbsDown, ExternalLink } from 'lucide-react';
import { helpArticles } from '../../data/helpContent';

interface HelpArticleProps {
  articleId: string;
  onBack: () => void;
  onNavigate: (articleId: string) => void;
  onRate?: (articleId: string, helpful: boolean) => void;
  rating?: boolean | null;
}

/** Very minimal markdown renderer — handles headers, bold, tables, code blocks, and lists */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const headers = tableRows[0];
    const body = tableRows.slice(2); // Skip separator row
    elements.push(
      <div key={`table-${elements.length}`} className="overflow-x-auto my-3">
        <table className="w-full text-[11px] border border-zinc-800/30 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-zinc-900/30">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-bold text-zinc-300 border-b border-zinc-800/30">
                  {formatInline(h.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-b border-zinc-800/20 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-zinc-400">
                    {formatInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="bg-zinc-900/50 border border-zinc-800/30 rounded-lg px-3 py-2 my-2 text-[11px] font-mono text-zinc-300 overflow-x-auto">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        if (inTable) flushTable();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table rows
    if (line.trim().startsWith('|')) {
      if (!inTable) inTable = true;
      const cells = line.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Empty line
    if (!line.trim()) {
      continue;
    }

    // Headers
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-lg font-bold text-zinc-100 mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-bold text-zinc-200 mt-4 mb-1.5 border-b border-zinc-800/20 pb-1">
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-xs font-bold text-zinc-300 mt-3 mb-1">
          {line.slice(4)}
        </h3>
      );
      continue;
    }

    // List items
    if (line.trim().startsWith('- ')) {
      elements.push(
        <div key={i} className="flex gap-2 pl-2 py-0.5 text-[12px] text-zinc-400 leading-relaxed">
          <span className="text-zinc-600 mt-0.5">•</span>
          <span>{formatInline(line.trim().slice(2))}</span>
        </div>
      );
      continue;
    }

    // Numbered list items
    const numMatch = line.trim().match(/^(\d+)\.\s(.+)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 pl-2 py-0.5 text-[12px] text-zinc-400 leading-relaxed">
          <span className="text-zinc-600 font-mono text-[10px] mt-0.5 w-4 shrink-0">{numMatch[1]}.</span>
          <span>{formatInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Paragraph
    elements.push(
      <p key={i} className="text-[12px] text-zinc-400 leading-relaxed my-1.5">
        {formatInline(line)}
      </p>
    );
  }

  if (inTable) flushTable();

  return elements;
}

/** Format inline markdown: **bold**, `code`, *italic* */
function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Simple regex-based inline formatting
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // Bold
      parts.push(<strong key={match.index} className="font-bold text-zinc-200">{match[2]}</strong>);
    } else if (match[3]) {
      // Code
      parts.push(
        <code key={match.index} className="px-1 py-0.5 bg-zinc-800/50 rounded text-[10px] font-mono text-zinc-300 border border-zinc-700/30">
          {match[3]}
        </code>
      );
    } else if (match[4]) {
      // Italic
      parts.push(<em key={match.index} className="italic text-zinc-300">{match[4]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

const HelpArticleView: React.FC<HelpArticleProps> = ({
  articleId,
  onBack,
  onNavigate,
  onRate,
  rating,
}) => {
  const article = helpArticles[articleId];

  if (!article) {
    return (
      <div className="p-6 text-center">
        <p className="text-zinc-500 text-sm">Article not found</p>
        <button onClick={onBack} className="text-indigo-400 text-xs mt-2 hover:text-indigo-300">
          ← Go back
        </button>
      </div>
    );
  }

  // Find related articles
  const related = article.relatedArticles
    .map(id => helpArticles[id])
    .filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/30 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-md hover:bg-zinc-800/40 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[10px] text-zinc-600 font-medium capitalize">
          {article.category.replace('-', ' ')}
        </span>
      </div>

      {/* Article content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        {renderMarkdown(article.content)}

        {/* Examples */}
        {article.examples && article.examples.length > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-800/20">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-400/70 mb-2">
              Try Saying
            </h3>
            <div className="flex flex-col gap-1">
              {article.examples.map((example, i) => (
                <div
                  key={i}
                  className="px-3 py-2 bg-zinc-900/30 border border-zinc-800/20 rounded-lg text-[11px] text-zinc-400 italic"
                >
                  "{example}"
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related */}
        {related.length > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-800/20">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 mb-2">
              Related
            </h3>
            <div className="flex flex-col gap-0.5">
              {related.map(rel => (
                <button
                  key={rel.id}
                  onClick={() => onNavigate(rel.id)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-colors text-left"
                >
                  <ExternalLink size={10} className="shrink-0 text-zinc-600" />
                  {rel.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feedback */}
        {onRate && (
          <div className="mt-4 pt-3 border-t border-zinc-800/20">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-600">Was this helpful?</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onRate(articleId, true)}
                  className={`
                    p-1.5 rounded-md transition-all duration-200
                    ${rating === true
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30'}
                  `}
                >
                  <ThumbsUp size={12} />
                </button>
                <button
                  onClick={() => onRate(articleId, false)}
                  className={`
                    p-1.5 rounded-md transition-all duration-200
                    ${rating === false
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30'}
                  `}
                >
                  <ThumbsDown size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HelpArticleView;

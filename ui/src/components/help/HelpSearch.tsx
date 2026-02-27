import React, { useRef, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import { helpArticles, type HelpArticle } from '../../data/helpContent';

interface HelpSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  onSelectArticle: (articleId: string) => void;
  autoFocus?: boolean;
}

interface SearchResult {
  article: HelpArticle;
  score: number;
  matchType: 'title' | 'tag' | 'content';
}

function fuzzySearch(query: string): SearchResult[] {
  if (!query.trim()) return [];

  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const article of Object.values(helpArticles)) {
    let bestScore = 0;
    let bestMatchType: 'title' | 'tag' | 'content' = 'content';

    // Title match (3x weight)
    const titleLower = article.title.toLowerCase();
    if (titleLower.includes(q)) {
      const score = q.length / titleLower.length;
      const weighted = score * 3;
      if (weighted > bestScore) {
        bestScore = weighted;
        bestMatchType = 'title';
      }
    }

    // Tag match (2x weight)
    for (const tag of article.tags) {
      if (tag.toLowerCase().includes(q)) {
        const score = q.length / tag.length;
        const weighted = score * 2;
        if (weighted > bestScore) {
          bestScore = weighted;
          bestMatchType = 'tag';
        }
      }
    }

    // Content match (1x weight) — first 500 chars only for performance
    const contentLower = article.content.toLowerCase().slice(0, 500);
    if (contentLower.includes(q)) {
      const score = q.length / 100; // Normalize
      if (score > bestScore) {
        bestScore = score;
        bestMatchType = 'content';
      }
    }

    // Also check examples
    if (article.examples) {
      for (const example of article.examples) {
        if (example.toLowerCase().includes(q)) {
          const score = (q.length / example.length) * 1.5;
          if (score > bestScore) {
            bestScore = score;
            bestMatchType = 'content';
          }
        }
      }
    }

    if (bestScore > 0) {
      results.push({ article, score: bestScore, matchType: bestMatchType });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

const HelpSearch: React.FC<HelpSearchProps> = ({
  query,
  onQueryChange,
  onSelectArticle,
  autoFocus = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const results = useMemo(() => fuzzySearch(query), [query]);

  return (
    <div className="flex flex-col">
      {/* Search input */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/30">
        <Search size={14} className="text-zinc-500 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search help topics..."
          className="flex-1 bg-transparent border-none text-[13px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:ring-0"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/30 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="flex flex-col gap-0.5 p-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
          {results.length > 0 ? (
            results.map((result) => (
              <button
                key={result.article.id}
                onClick={() => onSelectArticle(result.article.id)}
                className="
                  flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg
                  text-left hover:bg-zinc-800/30 transition-all duration-150
                  group
                "
              >
                <span className="text-[12px] font-medium text-zinc-300 group-hover:text-white transition-colors">
                  {result.article.title}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {result.article.category.replace('-', ' ')}
                  {result.matchType === 'tag' && ' · tag match'}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-6 text-center">
              <p className="text-[12px] text-zinc-600">No results for "{query}"</p>
              <p className="text-[10px] text-zinc-700 mt-1">Try different keywords</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HelpSearch;

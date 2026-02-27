import React, { useEffect, useRef } from 'react';
import {
  X, BookOpen, Wrench, LayoutDashboard, Bot, Puzzle,
  Settings, Keyboard, GraduationCap, Play
} from 'lucide-react';
import { helpCategories, tours, helpArticles } from '../../data/helpContent';
import HelpSearch from './HelpSearch';
import HelpArticleView from './HelpArticle';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'getting-started': <BookOpen size={15} />,
  'tools': <Wrench size={15} />,
  'surfaces': <LayoutDashboard size={15} />,
  'agent-loop': <Bot size={15} />,
  'plugins-skills': <Puzzle size={15} />,
  'configuration': <Settings size={15} />,
  'shortcuts': <Keyboard size={15} />,
  'tours': <GraduationCap size={15} />,
};

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentArticleId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNavigateArticle: (articleId: string) => void;
  onBack: () => void;
  onHome: () => void;
  onStartTour: (tourId: string) => void;
  onRate?: (articleId: string, helpful: boolean) => void;
  ratings?: Record<string, boolean>;
  viewedArticles?: string[];
}

const HelpPanel: React.FC<HelpPanelProps> = ({
  isOpen,
  onClose,
  currentArticleId,
  searchQuery,
  onSearchChange,
  onNavigateArticle,
  onBack,
  onHome,
  onStartTour,
  onRate,
  ratings = {},
  viewedArticles = [],
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Recently viewed articles (up to 3)
  const recentlyViewed = viewedArticles
    .slice(-5)
    .reverse()
    .map(id => helpArticles[id])
    .filter(Boolean)
    .slice(0, 3);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[190] bg-black/30 animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="
          fixed top-0 right-0 bottom-0 z-[200] w-[380px] max-w-[90vw]
          bg-[#0a0a0a]/95 border-l border-zinc-800/40
          shadow-2xl shadow-black/50 backdrop-blur-xl
          flex flex-col overflow-hidden
          animate-slide-in-right
        "
        style={{
          animation: 'slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
              <BookOpen size={14} className="text-indigo-400" />
            </div>
            <h2 className="text-sm font-bold text-zinc-200 tracking-wide">Help</h2>
          </div>
          <div className="flex items-center gap-1">
            {currentArticleId && (
              <button
                onClick={onHome}
                className="px-2 py-1 rounded-md text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
              >
                Home
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-150"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <HelpSearch
          query={searchQuery}
          onQueryChange={onSearchChange}
          onSelectArticle={onNavigateArticle}
          autoFocus={!currentArticleId}
        />

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {currentArticleId && !searchQuery ? (
            <HelpArticleView
              articleId={currentArticleId}
              onBack={onBack}
              onNavigate={onNavigateArticle}
              onRate={onRate}
              rating={ratings[currentArticleId] ?? null}
            />
          ) : !searchQuery ? (
            <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar space-y-5">
              {/* Category list */}
              <div className="space-y-1">
                {helpCategories.map((cat, idx) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      // Navigate to first article in category
                      const firstArticle = cat.articles[0];
                      if (firstArticle) onNavigateArticle(firstArticle);
                    }}
                    className="
                      w-full flex items-center gap-3 px-3 py-3 rounded-xl
                      hover:bg-zinc-800/30 transition-all duration-200
                      group text-left border border-transparent hover:border-zinc-800/20
                    "
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <div className="p-2 rounded-lg bg-zinc-800/40 text-zinc-400 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-all duration-200">
                      {CATEGORY_ICONS[cat.id] || <BookOpen size={15} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-zinc-300 group-hover:text-zinc-100 transition-colors">
                        {cat.title}
                      </div>
                      <div className="text-[10px] text-zinc-600 truncate">
                        {cat.description}
                      </div>
                    </div>
                    <span className="text-[10px] text-zinc-700 font-mono shrink-0">
                      {cat.articles.length}
                    </span>
                  </button>
                ))}
              </div>

              {/* Recently viewed */}
              {recentlyViewed.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
                      Recently Viewed
                    </h3>
                    <div className="flex-1 h-px bg-zinc-800/30" />
                  </div>
                  <div className="space-y-0.5">
                    {recentlyViewed.map(article => (
                      <button
                        key={article.id}
                        onClick={() => onNavigateArticle(article.id)}
                        className="w-full px-3 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/20 transition-colors text-left truncate"
                      >
                        {article.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tours */}
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
                    Interactive Tours
                  </h3>
                  <div className="flex-1 h-px bg-zinc-800/30" />
                </div>
                <div className="space-y-1">
                  {tours.map(tour => (
                    <button
                      key={tour.id}
                      onClick={() => {
                        onClose();
                        setTimeout(() => onStartTour(tour.id), 300);
                      }}
                      className="
                        w-full flex items-center gap-3 px-3 py-2 rounded-lg
                        hover:bg-zinc-800/20 transition-all duration-200
                        group text-left
                      "
                    >
                      <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400/70 group-hover:text-emerald-400 transition-colors">
                        <Play size={10} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">
                          {tour.name}
                        </span>
                        <span className="text-[10px] text-zinc-700 ml-2">
                          {tour.steps.length} steps
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Keyboard shortcut hint */}
              <div className="px-3 py-2 bg-zinc-900/30 rounded-lg border border-zinc-800/20 text-center">
                <span className="text-[10px] text-zinc-600">
                  Press <kbd className="px-1.5 py-0.5 bg-zinc-800/40 rounded border border-zinc-700/30 font-mono text-zinc-500 mx-0.5">⌘/</kbd> to toggle this panel
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
};

export default HelpPanel;

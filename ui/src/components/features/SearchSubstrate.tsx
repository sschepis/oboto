import React from 'react';
import { Globe, Link, ExternalLink } from 'lucide-react';

interface SearchResult {
  source: string;
  title: string;
  snippet: string;
}

interface SearchSubstrateProps {
  query: string;
  results: SearchResult[];
}

const SearchSubstrate: React.FC<SearchSubstrateProps> = ({ query, results }) => (
  <div className="w-full bg-[#0a0a0a] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-2xl shadow-black/30 my-4 animate-fade-in-up">
    <div className="px-5 py-3 bg-zinc-900/20 border-b border-zinc-800/30 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-1 rounded-md bg-blue-500/10">
          <Globe size={12} className="text-blue-400" />
        </div>
        <span className="text-[11px] font-bold text-zinc-300">
          Search: <span className="text-blue-400 font-mono">{query}</span>
        </span>
      </div>
      <span className="text-[9px] text-zinc-600 tabular-nums">{results?.length || 0} results</span>
    </div>
    <div className="p-4 space-y-2">
      {results?.map((res, i) => (
        <div 
          key={i} 
          className="p-3.5 rounded-xl bg-zinc-900/20 border border-zinc-800/30 hover:border-blue-500/20 hover:bg-zinc-900/30 transition-all duration-200 cursor-pointer group animate-fade-in"
          style={{ animationDelay: `${i * 0.05}s` }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Link size={9} className="text-zinc-600" />
            <span className="text-[10px] font-bold text-blue-400/70 uppercase tracking-wider">{res.source}</span>
            <ExternalLink size={9} className="ml-auto text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </div>
          <p className="text-xs font-semibold text-zinc-200 mb-1 group-hover:text-zinc-100 transition-colors duration-200">{res.title}</p>
          <p className="text-[11px] text-zinc-500 leading-relaxed">{res.snippet}</p>
        </div>
      ))}
    </div>
  </div>
);

export default SearchSubstrate;

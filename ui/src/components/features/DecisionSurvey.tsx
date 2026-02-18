import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface DecisionSurveyProps {
  question?: string;
  options?: string[];
}

const DecisionSurvey: React.FC<DecisionSurveyProps> = ({ question, options = [] }) => {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <HelpCircle size={16} />
        </div>
        <span className="text-sm font-bold text-zinc-200 leading-tight">{question}</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={`w-full text-left px-4 py-3 rounded-xl border text-xs font-medium transition-all ${
              selected === i 
              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg translate-x-1' 
              : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default DecisionSurvey;

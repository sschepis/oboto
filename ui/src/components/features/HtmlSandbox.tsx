import React from 'react';
import { Eye } from 'lucide-react';

interface HtmlSandboxProps {
  code?: string;
}

const HtmlSandbox: React.FC<HtmlSandboxProps> = ({ code }) => (
  <div className="w-full bg-white rounded-2xl overflow-hidden shadow-2xl my-4">
    <div className="bg-zinc-100 px-4 py-2 border-b border-zinc-200 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5 mr-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
        </div>
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Sandbox Preview</span>
      </div>
      <Eye size={14} className="text-zinc-400" />
    </div>
    <div className="p-0 min-h-[200px]">
      <iframe title="preview" srcDoc={code} className="w-full h-[300px] border-none" sandbox="allow-scripts" />
    </div>
  </div>
);

export default HtmlSandbox;

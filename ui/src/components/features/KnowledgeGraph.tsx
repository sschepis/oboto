import React from 'react';
import type { GraphNode, GraphLink } from '../../types';

interface KnowledgeGraphProps {
  nodes?: GraphNode[];
  links?: GraphLink[];
}

const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({ 
  nodes = [
    { x: 50, y: 50, label: 'Core' }, 
    { x: 150, y: 30, label: 'Logic' }, 
    { x: 140, y: 120, label: 'Memory' }, 
    { x: 250, y: 80, label: 'Intent' }
  ],
  links = [
    { x1: 50, y1: 50, x2: 150, y2: 30 },
    { x1: 50, y1: 50, x2: 140, y2: 120 },
    { x1: 150, y1: 30, x2: 250, y2: 80 },
    { x1: 140, y1: 120, x2: 250, y2: 80 }
  ]
}) => {
  return (
    <div className="w-full h-48 relative overflow-hidden bg-zinc-950 rounded-[2.5rem] border border-zinc-900/50 p-6">
      <svg className="w-full h-full relative z-10">
        {links.map((link, i) => (
          <line key={`link-${i}`} x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2} stroke="#4f46e5" strokeWidth="1" strokeDasharray="4" />
        ))}
        {nodes.map((node, i) => (
          <g key={`node-${i}`}>
            <circle cx={node.x} cy={node.y} r="4" fill="#818cf8" className="animate-pulse" />
            <text x={node.x + 10} y={node.y + 4} fill="#6366f1" className="text-[8px] font-black uppercase tracking-widest">{node.label}</text>
          </g>
        ))}
      </svg>
      <div className="absolute bottom-4 left-6 text-[8px] font-black text-zinc-700 uppercase tracking-widest">Shared Memory Graph</div>
    </div>
  );
};

export default KnowledgeGraph;


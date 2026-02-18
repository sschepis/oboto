import React from 'react';

interface TelemetryGraphProps {
  label: string;
  color?: "indigo" | "emerald";
  data?: number[];
}

const TelemetryGraph: React.FC<TelemetryGraphProps> = ({ label, color = "indigo", data = [] }) => {
  // Use provided data or default to a flat line (or handle empty state)
  // Assuming data is array of numbers 0-100
  const displayData = data.length > 0 ? data : Array(20).fill(0);
  const pathData = displayData.map((d, i) => `${(i * 10)} ${100 - d}`).join(' L ');
  const currentValue = displayData.length > 0 ? displayData[displayData.length - 1].toFixed(1) : '0.0';

  return (
    <div className="w-full bg-zinc-900/20 border border-zinc-800/50 rounded-2xl p-4 space-y-3">
      <div className="flex justify-between items-center px-1">
        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{label}</span>
        <span className="text-[10px] font-mono font-bold text-indigo-400 tracking-tighter">{currentValue}%</span>
      </div>
      <svg viewBox="0 0 190 100" className="w-full h-16 overflow-visible">
        <path
          d={`M 0 ${100 - displayData[0]} L ${pathData}`}
          fill="none"
          stroke={color === "indigo" ? "#818cf8" : "#10b981"}
          strokeWidth="2"
          strokeLinecap="round"
          className="transition-all duration-300"
        />
        <path
          d={`M 0 100 L 0 ${100 - displayData[0]} L ${pathData} L 190 100 Z`}
          fill={`url(#fill-${label.replace(/\s+/g, '-')})`}
          className="opacity-10 transition-all duration-300"
        />
        <defs>
          <linearGradient id={`fill-${label.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color === "indigo" ? "#818cf8" : "#10b981"} />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

export default TelemetryGraph;


import React from 'react';

interface VoiceWaveformProps {
  data?: number[];
}

const VoiceWaveform: React.FC<VoiceWaveformProps> = ({ data = [] }) => {
  const bars = data.length > 0 ? data : [0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 0.4, 0.8, 1, 0.5];

  return (
    <div className="flex items-center gap-[3px] h-6">
      {bars.map((h, i) => (
        <div 
          key={i} 
          className="w-[3px] bg-gradient-to-t from-indigo-600/40 to-indigo-400/60 rounded-full" 
          style={{ 
            height: `${h * 100}%`, 
            animation: `breathe 1.5s ease-in-out infinite`,
            animationDelay: `${i * 0.08}s`
          }}
        />
      ))}
    </div>
  );
};

export default VoiceWaveform;

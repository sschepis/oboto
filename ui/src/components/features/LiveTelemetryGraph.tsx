import React, { useState, useEffect } from 'react';
import TelemetryGraph from './TelemetryGraph';

interface LiveTelemetryGraphProps {
  label: string;
  color?: "indigo" | "emerald";
  enabled?: boolean;
}

const LiveTelemetryGraph: React.FC<LiveTelemetryGraphProps> = ({ label, color = "indigo", enabled = true }) => {
  // Use deterministic initial data to avoid hydration mismatch and purity issues
  const [data, setData] = useState(Array.from({ length: 20 }, (_, i) => 40 + Math.sin(i) * 10));

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setData(prev => {
        // Shift left, push new random value
        const nextValue = 30 + Math.random() * 40;
        return [...prev.slice(1), nextValue];
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [enabled]);

  return <TelemetryGraph label={label} color={color} data={data} />;
};

export default LiveTelemetryGraph;

import React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

export interface SparklineProps {
  data: number[];
  height?: number;
  color?: string;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  height = 40,
  color = '#6366f1',
  className = '',
}) => {
  const chartData = data.map((val, i) => ({ i, val }));

  return (
    <div style={{ height }} className={`w-32 ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="val"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

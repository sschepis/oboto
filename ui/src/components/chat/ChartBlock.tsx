import React, { useMemo } from 'react';
import { LineChart } from '../../surface-kit/charts/LineChart';
import { BarChart } from '../../surface-kit/charts/BarChart';
import { PieChart } from '../../surface-kit/charts/PieChart';
import { AreaChart } from '../../surface-kit/charts/AreaChart';
import { Sparkline } from '../../surface-kit/charts/Sparkline';

interface ChartBlockProps {
  code: string;
}

type BaseChartConfig = {
    title?: string;
    description?: string;
    colors?: string[];
    height?: number;
};

type StandardChartConfig = BaseChartConfig & {
    type: 'line' | 'bar' | 'pie' | 'area';
    data: Record<string, unknown>[];
    xKey?: string;
    yKeys?: string[]; // for line, bar, area
    nameKey?: string; // for pie
    valueKey?: string; // for pie
    stacked?: boolean; // for bar, area
    gradient?: boolean; // for area
};

type SparklineConfig = BaseChartConfig & {
    type: 'sparkline';
    data: number[];
};

type ChartConfig = StandardChartConfig | SparklineConfig;

export const ChartBlock: React.FC<ChartBlockProps> = ({ code }) => {
  const config: ChartConfig | null = useMemo(() => {
    try {
      return JSON.parse(code);
    } catch (e) {
      console.error('Failed to parse chart config:', e);
      return null;
    }
  }, [code]);

  if (!config) {
    return (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
            Invalid chart configuration
        </div>
    );
  }

  const renderChart = () => {
    switch (config.type) {
        case 'line':
            return <LineChart data={config.data} xKey={config.xKey || 'name'} yKeys={config.yKeys || ['value']} colors={config.colors} height={config.height} />;
        case 'bar':
            return <BarChart data={config.data} xKey={config.xKey || 'name'} yKeys={config.yKeys || ['value']} colors={config.colors} stacked={config.stacked} height={config.height} />;
        case 'pie':
             return <PieChart data={config.data} nameKey={config.nameKey || 'name'} valueKey={config.valueKey || 'value'} colors={config.colors} height={config.height} />;
        case 'area':
             return <AreaChart data={config.data} xKey={config.xKey || 'name'} yKeys={config.yKeys || ['value']} colors={config.colors} stacked={config.stacked} gradient={config.gradient} height={config.height} />;
        case 'sparkline':
             return <Sparkline data={config.data} color={config.colors?.[0]} height={config.height} />;
        default:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return <div>Unsupported chart type: {(config as any).type}</div>;
    }
  };

  return (
    <div className="my-6 rounded-xl bg-[#0a0a0a] border border-zinc-800/50 overflow-hidden shadow-lg transition-all duration-300 hover:border-zinc-700/40">
        {(config.title || config.description) && (
            <div className="px-5 py-4 border-b border-zinc-800/30 bg-zinc-900/20">
                {config.title && <h3 className="text-sm font-bold text-zinc-200">{config.title}</h3>}
                {config.description && <p className="text-xs text-zinc-500 mt-1">{config.description}</p>}
            </div>
        )}
        <div className="p-5">
            {renderChart()}
        </div>
    </div>
  );
};

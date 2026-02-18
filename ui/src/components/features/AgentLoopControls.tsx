import { useState } from 'react';
import type { AgentLoopStatus, AgentLoopInvocation } from '../../hooks/useAgentLoop';

interface AgentLoopControlsProps {
  status: AgentLoopStatus;
  lastInvocation: AgentLoopInvocation | null;
  onPlay: (intervalMs?: number) => void;
  onPause: () => void;
  onStop: () => void;
  onSetInterval: (intervalMs: number) => void;
}

const INTERVAL_PRESETS = [
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '2m', ms: 120000 },
  { label: '5m', ms: 300000 },
  { label: '10m', ms: 600000 },
];

export function AgentLoopControls({
  status,
  lastInvocation,
  onPlay,
  onPause,
  onStop,
  onSetInterval,
}: AgentLoopControlsProps) {
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const { state, intervalMs, invocationCount } = status;

  const formatInterval = (ms: number) => {
    if (ms < 60000) return `${ms / 1000}s`;
    return `${ms / 60000}m`;
  };

  const stateColor = state === 'playing' ? '#22c55e' : state === 'paused' ? '#f59e0b' : '#6b7280';
  const stateIcon = state === 'playing' ? '●' : state === 'paused' ? '⏸' : '○';
  const stateLabel = state === 'playing' ? 'Running' : state === 'paused' ? 'Paused' : 'Stopped';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        background: '#0d1117',
        borderRadius: 8,
        border: `1px solid ${stateColor}33`,
        fontSize: 12,
        position: 'relative',
      }}
    >
      {/* State indicator */}
      <span
        style={{
          color: stateColor,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 70,
        }}
        title={`Agent Loop: ${stateLabel}`}
      >
        <span style={{ fontSize: 10, animation: state === 'playing' ? 'pulse 2s infinite' : 'none' }}>
          {stateIcon}
        </span>
        {stateLabel}
      </span>

      {/* Transport controls */}
      <div style={{ display: 'flex', gap: 2 }}>
        {/* Play / Resume button */}
        {(state === 'stopped' || state === 'paused') && (
          <button
            onClick={() => onPlay(state === 'stopped' ? intervalMs : undefined)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              background: '#22c55e22',
              color: '#22c55e',
              border: '1px solid #22c55e44',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title={state === 'paused' ? 'Resume agent loop' : `Start agent loop (every ${formatInterval(intervalMs)})`}
          >
            ▶ {state === 'paused' ? 'Resume' : 'Play'}
          </button>
        )}

        {/* Pause button */}
        {state === 'playing' && (
          <button
            onClick={onPause}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              background: '#f59e0b22',
              color: '#f59e0b',
              border: '1px solid #f59e0b44',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title="Pause agent loop"
          >
            ⏸ Pause
          </button>
        )}

        {/* Stop button */}
        {(state === 'playing' || state === 'paused') && (
          <button
            onClick={onStop}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              background: '#ef444422',
              color: '#ef4444',
              border: '1px solid #ef444444',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title="Stop agent loop"
          >
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Interval selector */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowIntervalPicker(!showIntervalPicker)}
          style={{
            padding: '3px 8px',
            borderRadius: 4,
            background: '#1a1a2e',
            color: '#9ca3af',
            border: '1px solid #30363d',
            cursor: 'pointer',
            fontSize: 11,
          }}
          title="Set invocation interval"
        >
          ⏱ {formatInterval(intervalMs)}
        </button>

        {showIntervalPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {INTERVAL_PRESETS.map(preset => (
              <button
                key={preset.ms}
                onClick={() => {
                  onSetInterval(preset.ms);
                  setShowIntervalPicker(false);
                }}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  background: preset.ms === intervalMs ? '#22c55e22' : 'transparent',
                  color: preset.ms === intervalMs ? '#22c55e' : '#9ca3af',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}
              >
                Every {preset.label} {preset.ms === intervalMs ? '✓' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Invocation counter */}
      {invocationCount > 0 && (
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 10,
            background: '#3b82f622',
            color: '#3b82f6',
            fontSize: 10,
            fontWeight: 600,
          }}
          title={lastInvocation ? `Last: ${lastInvocation.timestamp}` : undefined}
        >
          #{invocationCount}
        </span>
      )}

      {/* Inline pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

import React, { useMemo } from 'react';
import type { Workflow, WorkflowInteraction, WorkflowStep } from '../../hooks/useWorkflow';

interface WorkflowStatusBarProps {
  workflows: Workflow[];
  interactions: WorkflowInteraction[];
  onSubmitInteraction: (workflowId: string, interactionId: string, data: Record<string, unknown>) => void;
  onCancelWorkflow: (workflowId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#22c55e',
  paused: '#f59e0b',
  completed: '#3b82f6',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

const STATUS_ICONS: Record<string, string> = {
  running: '⚡',
  paused: '⏸️',
  completed: '✅',
  failed: '❌',
  cancelled: '🚫',
};

function StepIndicator({ step, index }: { step: WorkflowStep; index: number }) {
  const color = step.status === 'completed' ? '#22c55e'
    : step.status === 'running' ? '#3b82f6'
    : step.status === 'failed' ? '#ef4444'
    : '#4b5563';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        fontSize: 11,
        color,
      }}
      title={`Step ${index + 1}: ${step.bubbleName} — ${step.status}`}
    >
      <span style={{ fontWeight: 600 }}>{step.bubbleName}</span>
      {step.status === 'running' && <span className="animate-pulse">●</span>}
      {step.status === 'completed' && <span>✓</span>}
      {step.status === 'failed' && <span>✗</span>}
    </div>
  );
}

function InteractionPrompt({
  interaction,
  onSubmit,
}: {
  interaction: WorkflowInteraction;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [value, setValue] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Try parsing as JSON first
      const parsed = JSON.parse(value);
      onSubmit(typeof parsed === 'object' && parsed !== null ? parsed : { value: parsed });
    } catch {
      // Fall back to string
      onSubmit({ value });
    }
    setValue('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 10px',
        background: '#f59e0b22',
        border: '1px solid #f59e0b44',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <span style={{ color: '#f59e0b', fontWeight: 600 }}>⏸️ {interaction.prompt}</span>
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Enter response..."
        style={{
          flex: 1,
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #555',
          background: '#1a1a2e',
          color: '#e0e0e0',
          fontSize: 12,
          outline: 'none',
        }}
      />
      <button
        type="submit"
        style={{
          padding: '4px 12px',
          borderRadius: 4,
          background: '#f59e0b',
          color: '#000',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        Submit
      </button>
    </form>
  );
}

export function WorkflowStatusBar({ workflows, interactions, onSubmitInteraction, onCancelWorkflow }: WorkflowStatusBarProps) {
  const activeWorkflows = useMemo(
    () => workflows.filter(wf => wf.status === 'running' || wf.status === 'paused'),
    [workflows]
  );

  const recentCompleted = useMemo(
    () => workflows
      .filter(wf => wf.status === 'completed' || wf.status === 'failed')
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, 3),
    [workflows]
  );

  if (activeWorkflows.length === 0 && recentCompleted.length === 0 && interactions.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 12px',
        background: '#0d1117',
        borderBottom: '1px solid #30363d',
        fontSize: 12,
      }}
    >
      {activeWorkflows.map(wf => (
        <div key={wf.workflowId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: STATUS_COLORS[wf.status] }}>
            {STATUS_ICONS[wf.status]}
          </span>
          <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{wf.flowName}</span>
          <div style={{ display: 'flex', gap: 4, flex: 1, overflow: 'auto' }}>
            {wf.steps.map((step, i) => (
              <StepIndicator key={i} step={step} index={i} />
            ))}
          </div>
          <button
            onClick={() => onCancelWorkflow(wf.workflowId)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#ef444422',
              color: '#ef4444',
              border: '1px solid #ef444444',
              cursor: 'pointer',
              fontSize: 11,
            }}
            title="Cancel workflow"
          >
            Cancel
          </button>
        </div>
      ))}

      {interactions.map(int => (
        <InteractionPrompt
          key={int.interactionId}
          interaction={int}
          onSubmit={data => onSubmitInteraction(int.workflowId, int.interactionId, data)}
        />
      ))}

      {recentCompleted.length > 0 && activeWorkflows.length === 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: 0.6 }}>
          {recentCompleted.map(wf => (
            <span key={wf.workflowId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>{STATUS_ICONS[wf.status]}</span>
              <span style={{ color: '#9ca3af' }}>{wf.flowName}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

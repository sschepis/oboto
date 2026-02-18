import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  SkipForward,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileText,
  Beaker,
  Terminal,
  Trophy,
  AlertTriangle,
} from 'lucide-react';
import type { TestResults, TestSuite, TestCase } from '../../types';

// ── Use Beaker as FlaskConical substitute (lucide-react may not have FlaskConical) ──
const FlaskConical = Beaker;

interface TestResultsPanelProps {
  testResults: TestResults;
  onRerun?: () => void;
}

// ── Status icon helper ─────────────────────────────────────────────────────────
function StatusIcon({ status, size = 14 }: { status: TestCase['status']; size?: number }) {
  switch (status) {
    case 'passed':
      return <CheckCircle size={size} className="text-emerald-400 shrink-0" />;
    case 'failed':
      return <XCircle size={size} className="text-rose-400 shrink-0" />;
    case 'pending':
      return <Clock size={size} className="text-amber-400 shrink-0" />;
    case 'skipped':
      return <SkipForward size={size} className="text-zinc-500 shrink-0" />;
  }
}

// ── Format duration ────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Stat badge ─────────────────────────────────────────────────────────────────
function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${color} text-xs font-mono`}>
      <span className="font-bold">{value}</span>
      <span className="opacity-70 uppercase tracking-wider text-[9px]">{label}</span>
    </div>
  );
}

// ── Single test row ────────────────────────────────────────────────────────────
function TestRow({ test }: { test: TestCase }) {
  const [expanded, setExpanded] = useState(false);
  const hasFail = test.status === 'failed' && test.failureMessage;

  return (
    <div className="group">
      <div
        className={`
          flex items-center gap-2 px-3 py-1.5 text-xs
          ${hasFail ? 'cursor-pointer hover:bg-rose-500/5' : ''}
          ${test.status === 'failed' ? 'bg-rose-500/[0.03]' : ''}
          transition-colors
        `}
        onClick={() => hasFail && setExpanded(!expanded)}
      >
        {/* Expand chevron (only for failures) */}
        <div className="w-3">
          {hasFail && (
            expanded
              ? <ChevronDown size={10} className="text-zinc-600" />
              : <ChevronRight size={10} className="text-zinc-600" />
          )}
        </div>

        <StatusIcon status={test.status} size={12} />

        <span className={`flex-1 font-mono truncate ${
          test.status === 'passed' ? 'text-zinc-400'
            : test.status === 'failed' ? 'text-rose-300'
            : 'text-zinc-500'
        }`}>
          {test.name}
        </span>

        <span className="text-[10px] font-mono text-zinc-600 tabular-nums whitespace-nowrap">
          {formatDuration(test.duration)}
        </span>
      </div>

      {/* Expanded failure message */}
      {expanded && test.failureMessage && (
        <div className="mx-6 mb-2 p-3 bg-rose-950/30 border border-rose-800/30 rounded-lg overflow-x-auto">
          <pre className="text-[10px] leading-relaxed font-mono text-rose-300/90 whitespace-pre-wrap break-all">
            {test.failureMessage}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Suite section ──────────────────────────────────────────────────────────────
function SuiteSection({ suite }: { suite: TestSuite }) {
  const [collapsed, setCollapsed] = useState(suite.failed === 0);
  const allPassed = suite.failed === 0 && suite.pending === 0;

  // Shorten file path for display
  const displayName = suite.name.replace(/.*[/\\]/, '');
  const dirPath = suite.name.replace(/[/\\][^/\\]*$/, '');

  return (
    <div className={`
      border rounded-xl overflow-hidden transition-colors
      ${suite.failed > 0 ? 'border-rose-800/30 bg-rose-950/10' : 'border-zinc-800/50 bg-zinc-900/30'}
    `}>
      {/* Suite header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors text-left"
      >
        {collapsed
          ? <ChevronRight size={12} className="text-zinc-600 shrink-0" />
          : <ChevronDown size={12} className="text-zinc-600 shrink-0" />
        }

        {allPassed
          ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
          : <XCircle size={14} className="text-rose-500 shrink-0" />
        }

        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-zinc-300 font-mono">{displayName}</span>
          {dirPath !== suite.name && (
            <span className="text-[10px] text-zinc-600 font-mono ml-2 truncate">{dirPath}</span>
          )}
        </div>

        {/* Mini stats */}
        <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono">
          {suite.passed > 0 && <span className="text-emerald-500">{suite.passed}✓</span>}
          {suite.failed > 0 && <span className="text-rose-400">{suite.failed}✗</span>}
          {suite.pending > 0 && <span className="text-amber-400">{suite.pending}○</span>}
          <span className="text-zinc-600">{formatDuration(suite.duration)}</span>
        </div>
      </button>

      {/* Test list */}
      {!collapsed && (
        <div className="border-t border-zinc-800/30">
          {suite.tests.map((test, i) => (
            <TestRow key={i} test={test} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const TestResultsPanel: React.FC<TestResultsPanelProps> = ({ testResults, onRerun }) => {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const totalTests = testResults.totalPassed + testResults.totalFailed + testResults.totalPending;
  const allPassed = testResults.totalFailed === 0 && totalTests > 0;
  const hasResults = testResults.suites.length > 0;

  return (
    <div className="max-w-2xl w-full">
      <div className={`
        rounded-2xl overflow-hidden border
        ${allPassed ? 'border-emerald-800/40' : testResults.totalFailed > 0 ? 'border-rose-800/40' : 'border-zinc-800/50'}
        bg-[#0c0c0c]
      `}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className={`
          px-4 py-3 flex items-center gap-3
          ${allPassed
            ? 'bg-gradient-to-r from-emerald-950/50 to-transparent'
            : testResults.totalFailed > 0
              ? 'bg-gradient-to-r from-rose-950/50 to-transparent'
              : 'bg-gradient-to-r from-zinc-900/50 to-transparent'
          }
        `}>
          {/* Icon */}
          <div className={`
            w-8 h-8 rounded-xl flex items-center justify-center
            ${allPassed ? 'bg-emerald-500/15' : testResults.totalFailed > 0 ? 'bg-rose-500/15' : 'bg-zinc-700/30'}
          `}>
            {allPassed ? (
              <Trophy size={16} className="text-emerald-400" />
            ) : testResults.totalFailed > 0 ? (
              <AlertTriangle size={16} className="text-rose-400" />
            ) : (
              <FlaskConical size={16} className="text-zinc-400" />
            )}
          </div>

          {/* Title + subtitle */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-300">
                Test Results
              </span>
              {allPassed && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  All Passing
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">
              {testResults.testCommand}
            </div>
          </div>

          {/* Rerun button */}
          {onRerun && (
            <button
              onClick={onRerun}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600
                text-[10px] font-bold uppercase tracking-widest text-zinc-300
                transition-all duration-200 active:scale-95 shrink-0
              "
            >
              <RefreshCw size={10} />
              Rerun
            </button>
          )}
        </div>

        {/* ── Stats bar ──────────────────────────────────────────────── */}
        <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-zinc-800/50">
          <StatBadge
            label="passed"
            value={testResults.totalPassed}
            color="border-emerald-800/40 bg-emerald-500/5 text-emerald-400"
          />
          {testResults.totalFailed > 0 && (
            <StatBadge
              label="failed"
              value={testResults.totalFailed}
              color="border-rose-800/40 bg-rose-500/5 text-rose-400"
            />
          )}
          {testResults.totalPending > 0 && (
            <StatBadge
              label="pending"
              value={testResults.totalPending}
              color="border-amber-800/40 bg-amber-500/5 text-amber-400"
            />
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-600">
            <Clock size={10} />
            {formatDuration(testResults.totalDuration)}
          </div>

          <div className={`
            text-[10px] font-mono px-1.5 py-0.5 rounded
            ${testResults.exitCode === 0 ? 'text-emerald-600 bg-emerald-500/5' : 'text-rose-600 bg-rose-500/5'}
          `}>
            exit {testResults.exitCode}
          </div>
        </div>

        {/* ── Progress bar ────────────────────────────────────────── */}
        {totalTests > 0 && (
          <div className="h-1 flex">
            {testResults.totalPassed > 0 && (
              <div
                className="bg-emerald-500/60 h-full transition-all"
                style={{ width: `${(testResults.totalPassed / totalTests) * 100}%` }}
              />
            )}
            {testResults.totalFailed > 0 && (
              <div
                className="bg-rose-500/60 h-full transition-all"
                style={{ width: `${(testResults.totalFailed / totalTests) * 100}%` }}
              />
            )}
            {testResults.totalPending > 0 && (
              <div
                className="bg-amber-500/40 h-full transition-all"
                style={{ width: `${(testResults.totalPending / totalTests) * 100}%` }}
              />
            )}
          </div>
        )}

        {/* ── Test suites ─────────────────────────────────────────── */}
        {hasResults && (
          <div className="p-3 space-y-2">
            {testResults.suites.map((suite, i) => (
              <SuiteSection key={i} suite={suite} />
            ))}
          </div>
        )}

        {/* ── No suites fallback (raw output only) ─────────────── */}
        {!hasResults && testResults.rawOutput && (
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={12} className="text-zinc-600" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Raw Output
              </span>
            </div>
            <pre className="text-[10px] font-mono text-zinc-400 bg-zinc-950 p-3 rounded-xl border border-zinc-800/50 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
              {testResults.rawOutput}
            </pre>
          </div>
        )}

        {/* ── Collapsible raw output ──────────────────────────────── */}
        {hasResults && testResults.rawOutput && (
          <div className="border-t border-zinc-800/30">
            <button
              onClick={() => setShowRawOutput(!showRawOutput)}
              className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors text-left"
            >
              {showRawOutput
                ? <ChevronDown size={10} className="text-zinc-600" />
                : <ChevronRight size={10} className="text-zinc-600" />
              }
              <FileText size={10} className="text-zinc-600" />
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                Raw Output
              </span>
            </button>
            {showRawOutput && (
              <div className="px-4 pb-3">
                <pre className="text-[10px] font-mono text-zinc-500 bg-zinc-950 p-3 rounded-xl border border-zinc-800/50 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {testResults.rawOutput}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TestResultsPanel;

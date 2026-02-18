import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Minus, Maximize2, Minimize2, X, Wifi, WifiOff, GripHorizontal } from 'lucide-react';
import { useGuakeTerminal } from '../../hooks/useGuakeTerminal';
import '@xterm/xterm/css/xterm.css';

interface GuakeTerminalProps {
  isVisible: boolean;
  onClose: () => void;
}

const MIN_HEIGHT_VH = 15;
const MAX_HEIGHT_VH = 85;
const DEFAULT_HEIGHT_VH = 40;

const GuakeTerminal: React.FC<GuakeTerminalProps> = ({ isVisible, onClose }) => {
  const [heightVh, setHeightVh] = useState(DEFAULT_HEIGHT_VH);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const prevHeightRef = useRef(DEFAULT_HEIGHT_VH);

  const { terminalRef, isConnected, fit, shellName, terminalCwd, isFallback } = useGuakeTerminal({ isVisible });

  // Resize handle drag
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = heightVh;
  }, [heightVh]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartY.current;
      const deltaVh = (deltaY / window.innerHeight) * 100;
      const newHeight = Math.min(MAX_HEIGHT_VH, Math.max(MIN_HEIGHT_VH, dragStartHeight.current + deltaVh));
      setHeightVh(newHeight);
      setIsMaximized(false);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Refit terminal after resize
      requestAnimationFrame(() => fit());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, fit]);

  // Toggle maximize
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setHeightVh(prevHeightRef.current);
      setIsMaximized(false);
    } else {
      prevHeightRef.current = heightVh;
      setHeightVh(MAX_HEIGHT_VH);
      setIsMaximized(true);
    }
    setTimeout(() => fit(), 300);
  }, [isMaximized, heightVh, fit]);

  // Refit when height changes
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => fit(), 320);
      return () => clearTimeout(timer);
    }
  }, [heightVh, isVisible, fit]);

  const actualHeight = isMaximized ? MAX_HEIGHT_VH : heightVh;
  const shellBaseName = shellName.split('/').pop() || 'terminal';

  return (
    <>
      {/* Backdrop overlay for visual context */}
      {isVisible && (
        <div
          className="fixed inset-0 z-[998] bg-black/40 backdrop-blur-[2px] transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Terminal panel */}
      <div
        className={`
          fixed top-0 left-0 right-0 z-[999]
          transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isVisible ? 'translate-y-0' : '-translate-y-full'}
        `}
        style={{ height: `${actualHeight}vh` }}
      >
        <div className="h-full flex flex-col bg-[#0a0a0a] border-b-2 border-emerald-500/30 shadow-[0_4px_40px_rgba(16,185,129,0.15)]">
          {/* ── Toolbar ────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#111111] border-b border-zinc-800/80 select-none shrink-0">
            {/* Left: traffic lights + title */}
            <div className="flex items-center gap-3">
              {/* Decorative traffic lights */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onClose}
                  className="w-3 h-3 rounded-full bg-rose-500/80 hover:bg-rose-500 transition-colors group relative"
                  title="Close (` or Esc)"
                >
                  <X size={7} className="absolute inset-0 m-auto text-rose-900 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button
                  onClick={onClose}
                  className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 transition-colors group relative"
                  title="Minimize"
                >
                  <Minus size={7} className="absolute inset-0 m-auto text-amber-900 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <button
                  onClick={toggleMaximize}
                  className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors group relative"
                  title={isMaximized ? 'Restore' : 'Maximize'}
                >
                  {isMaximized ? (
                    <Minimize2 size={6} className="absolute inset-0 m-auto text-emerald-900 opacity-0 group-hover:opacity-100 transition-opacity" />
                  ) : (
                    <Maximize2 size={6} className="absolute inset-0 m-auto text-emerald-900 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              </div>

              {/* Terminal icon + title */}
              <div className="flex items-center gap-2">
                <TerminalIcon size={12} className="text-emerald-500/70" />
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] font-mono">
                  {shellBaseName}
                </span>
              </div>
            </div>

            {/* Center: CWD */}
            <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-zinc-600 max-w-[40%] truncate">
              <span className="text-zinc-700">⌂</span>
              <span className="truncate">{terminalCwd || '~'}</span>
            </div>

            {/* Right: connection status + controls */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {isConnected ? (
                  <>
                    <Wifi size={10} className="text-emerald-500/70" />
                    <span className={`text-[8px] font-mono uppercase tracking-widest ${isFallback ? 'text-amber-500/50' : 'text-emerald-500/50'}`}>
                      {isFallback ? 'Basic' : 'PTY'}
                    </span>
                  </>
                ) : (
                  <>
                    <WifiOff size={10} className="text-zinc-600" />
                    <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">offline</span>
                  </>
                )}
              </div>

              <span className="text-[8px] font-mono text-zinc-700">
                <kbd className="px-1 py-0.5 bg-zinc-900 rounded border border-zinc-700 text-zinc-500">`</kbd>
                <span className="ml-1 text-zinc-700">toggle</span>
              </span>
            </div>
          </div>

          {/* ── Terminal body ──────────────────────────────────── */}
          <div
            ref={terminalRef}
            className="flex-1 min-h-0 overflow-hidden px-1 py-1"
            style={{ background: '#0a0a0a' }}
          />

          {/* ── Scan line overlay (subtle CRT effect) ─────────── */}
          <div
            className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
            style={{
              background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
            }}
          />

          {/* ── Resize handle ─────────────────────────────────── */}
          <div
            onMouseDown={handleDragStart}
            className={`
              shrink-0 h-2 cursor-row-resize flex items-center justify-center
              bg-gradient-to-b from-[#0a0a0a] to-[#111]
              border-t border-zinc-800/50
              hover:border-emerald-500/30 hover:bg-emerald-500/5
              transition-colors duration-200
              ${isDragging ? 'border-emerald-500/50 bg-emerald-500/10' : ''}
            `}
          >
            <GripHorizontal size={12} className="text-zinc-700" />
          </div>
        </div>

        {/* ── Bottom glow ──────────────────────────────────────── */}
        <div className="h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
      </div>
    </>
  );
};

export default GuakeTerminal;

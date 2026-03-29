import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Maximize, Minimize, Loader2, X } from 'lucide-react';
import { surfaceApi } from '../features/surface/surfaceApi';

interface MediaPlayerProps {
  filePath: string;
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

function getMediaType(filePath: string): 'audio' | 'video' {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'audio';
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    aac: 'audio/aac',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/mp4',
  };
  return mimeMap[ext] || (VIDEO_EXTENSIONS.includes(ext) ? 'video/mp4' : 'audio/mpeg');
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function MediaPlayer({ filePath }: MediaPlayerProps) {
  const mediaType = getMediaType(filePath);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Construct the streaming URL via the workspace content server
  const mediaUrl = surfaceApi.contentServerUrl(`/workspace-file/${filePath}`);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = mediaRef.current;
    if (!el) return;
    const vol = parseFloat(e.target.value);
    el.volume = vol;
    setVolume(vol);
    if (vol === 0) {
      el.muted = true;
      setIsMuted(true);
    } else if (el.muted) {
      el.muted = false;
      setIsMuted(false);
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = mediaRef.current;
    const bar = progressRef.current;
    if (!el || !bar || !isFinite(el.duration)) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  }, []);

  const skip = useCallback((seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + seconds));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          skip(-5);
          break;
        case 'ArrowRight':
          skip(5);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          if (mediaType === 'video') toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, skip, toggleMute, toggleFullscreen, mediaType]);

  if (!mediaUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e] text-zinc-500">
        <X className="mr-2" size={16} /> Workspace server not available
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const mediaEventHandlers = {
    onLoadedMetadata: () => {
      const el = mediaRef.current;
      if (el) setDuration(el.duration);
    },
    onCanPlay: () => setLoading(false),
    onTimeUpdate: () => {
      const el = mediaRef.current;
      if (el) setCurrentTime(el.currentTime);
    },
    onPlay: () => setIsPlaying(true),
    onPause: () => setIsPlaying(false),
    onEnded: () => setIsPlaying(false),
    onError: () => {
      setError('Failed to load media file');
      setLoading(false);
    },
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-[#0e0e0e] overflow-hidden">
      {/* Media Display Area */}
      <div className="flex-1 flex items-center justify-center relative bg-[#111] overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e0e]/80 z-10">
            <Loader2 className="animate-spin text-zinc-500 mr-2" size={20} />
            <span className="text-zinc-500 text-sm">Loading media...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center text-red-400 text-sm">
            <X className="mr-2" size={16} /> {error}
          </div>
        )}

        {mediaType === 'video' ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={mediaUrl}
            className="max-w-full max-h-full object-contain"
            playsInline
            {...mediaEventHandlers}
          />
        ) : (
          <div className="flex flex-col items-center gap-6 p-8">
            {/* Audio visualization placeholder */}
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/30 flex items-center justify-center shadow-lg shadow-violet-500/10">
              <div className={`w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/40 to-indigo-500/40 flex items-center justify-center ${isPlaying ? 'animate-pulse' : ''}`}>
                {isPlaying ? (
                  <div className="flex gap-1 items-end h-8">
                    <div className="w-1 bg-violet-400 rounded-full animate-[bounce_0.6s_infinite]" style={{ height: '60%' }} />
                    <div className="w-1 bg-violet-400 rounded-full animate-[bounce_0.8s_infinite_0.1s]" style={{ height: '80%' }} />
                    <div className="w-1 bg-violet-400 rounded-full animate-[bounce_0.5s_infinite_0.2s]" style={{ height: '40%' }} />
                    <div className="w-1 bg-violet-400 rounded-full animate-[bounce_0.7s_infinite_0.15s]" style={{ height: '70%' }} />
                    <div className="w-1 bg-violet-400 rounded-full animate-[bounce_0.6s_infinite_0.25s]" style={{ height: '50%' }} />
                  </div>
                ) : (
                  <Play size={32} className="text-violet-400 ml-1" />
                )}
              </div>
            </div>
            <div className="text-center">
              <p className="text-zinc-300 text-sm font-medium">{fileName}</p>
              <p className="text-zinc-600 text-xs mt-1">{getMimeType(filePath)}</p>
            </div>
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={mediaUrl}
              preload="metadata"
              {...mediaEventHandlers}
            />
          </div>
        )}
      </div>

      {/* Transport Controls */}
      <div className="border-t border-zinc-800 bg-zinc-900/80 px-4 py-3">
        {/* Progress Bar */}
        <div
          ref={progressRef}
          className="w-full h-1.5 bg-zinc-800 rounded-full cursor-pointer mb-3 group hover:h-2 transition-all"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-violet-500 rounded-full relative transition-all"
            style={{ width: `${progressPercent}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Display */}
          <span className="text-[11px] font-mono text-zinc-500 w-20 shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Playback Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => skip(-10)}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Back 10s"
            >
              <SkipBack size={14} />
            </button>

            <button
              onClick={togglePlay}
              className="p-2 rounded-full bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 hover:text-violet-200 transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>

            <button
              onClick={() => skip(10)}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Forward 10s"
            >
              <SkipForward size={14} />
            </button>
          </div>

          <div className="flex-1" />

          {/* Volume */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 h-1 accent-violet-500 cursor-pointer"
            />
          </div>

          {/* Fullscreen (video only) */}
          {mediaType === 'video' && (
            <button
              onClick={toggleFullscreen}
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

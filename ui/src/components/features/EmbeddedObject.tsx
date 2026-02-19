import React, { useState, useMemo } from 'react';
import { Play, ExternalLink, Video, Music, Code, MapPin, Globe } from 'lucide-react';
import type { EmbeddedObject as EmbedData, EmbedType } from '../../types';

/**
 * Extracts a YouTube video ID from various YouTube URL formats.
 */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extracts a Spotify embed path from a Spotify URL.
 * e.g. https://open.spotify.com/track/xxx → track/xxx
 */
function extractSpotifyPath(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

/**
 * Icon for each embed type.
 */
const EMBED_ICONS: Record<EmbedType, React.ReactNode> = {
  youtube: <Play size={16} />,
  video: <Video size={16} />,
  audio: <Music size={16} />,
  iframe: <Globe size={16} />,
  map: <MapPin size={16} />,
  tweet: <Globe size={16} />,
  codepen: <Code size={16} />,
  spotify: <Music size={16} />,
  figma: <Globe size={16} />,
  gist: <Code size={16} />,
  loom: <Video size={16} />,
  generic: <Globe size={16} />,
};

const EMBED_LABELS: Record<EmbedType, string> = {
  youtube: 'YouTube',
  video: 'Video',
  audio: 'Audio',
  iframe: 'Embed',
  map: 'Map',
  tweet: 'Tweet',
  codepen: 'CodePen',
  spotify: 'Spotify',
  figma: 'Figma',
  gist: 'GitHub Gist',
  loom: 'Loom',
  generic: 'Embed',
};

interface EmbeddedObjectProps {
  embed: EmbedData;
}

const EmbeddedObject: React.FC<EmbeddedObjectProps> = ({ embed }) => {
  const [loaded, setLoaded] = useState(false);
  const [showEmbed, setShowEmbed] = useState(!embed.thumbnailUrl);

  const width = embed.width ?? '100%';
  const resolvedHeight = useMemo(() => {
    if (embed.height) return embed.height;
    // Sensible defaults per type
    switch (embed.embedType) {
      case 'youtube':
      case 'video':
      case 'loom':
        return 360;
      case 'audio':
      case 'spotify':
        return 152;
      case 'tweet':
        return 400;
      case 'map':
        return 350;
      case 'codepen':
      case 'gist':
        return 400;
      case 'figma':
        return 450;
      default:
        return 400;
    }
  }, [embed.embedType, embed.height]);

  const embedSrc = useMemo(() => {
    switch (embed.embedType) {
      case 'youtube': {
        const videoId = extractYouTubeId(embed.url);
        if (!videoId) return embed.url;
        const params = new URLSearchParams();
        if (embed.startTime) params.set('start', String(embed.startTime));
        if (embed.autoplay) params.set('autoplay', '1');
        params.set('rel', '0');
        return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
      }
      case 'spotify': {
        const path = extractSpotifyPath(embed.url);
        if (!path) return embed.url;
        return `https://open.spotify.com/embed/${path}`;
      }
      case 'loom': {
        const m = embed.url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
        if (m) return `https://www.loom.com/embed/${m[1]}`;
        return embed.url;
      }
      case 'codepen': {
        // Convert codepen.io/user/pen/slug to embed URL
        const m = embed.url.match(/codepen\.io\/([^/]+)\/pen\/([^/?]+)/);
        if (m) return `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`;
        return embed.url;
      }
      case 'gist': {
        // GitHub gists need a wrapper
        return embed.url;
      }
      case 'figma': {
        return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(embed.url)}`;
      }
      case 'tweet': {
        // Twitter embeds typically need the Twitter widget script; we'll use an iframe approach
        return `https://platform.twitter.com/embed/Tweet.html?id=${embed.url.match(/status\/(\d+)/)?.[1] || ''}&theme=dark`;
      }
      case 'map': {
        // If it's already an embed URL, use it; otherwise try to make a Google Maps embed
        if (embed.url.includes('embed') || embed.url.includes('iframe')) return embed.url;
        return `https://maps.google.com/maps?q=${encodeURIComponent(embed.url)}&output=embed`;
      }
      case 'iframe':
      case 'generic':
      default:
        return embed.url;
    }
  }, [embed]);

  // For audio and native video, use HTML5 elements
  if (embed.embedType === 'audio') {
    return (
      <div className="w-full bg-[#0d0d0d] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800/30 bg-zinc-900/20">
          <span className="text-indigo-400">{EMBED_ICONS[embed.embedType]}</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
            {EMBED_LABELS[embed.embedType]}
          </span>
          {embed.title && (
            <span className="text-xs text-zinc-300 ml-2 truncate">{embed.title}</span>
          )}
        </div>
        <div className="p-4">
          <audio
            src={embed.url}
            controls
            autoPlay={embed.autoplay}
            className="w-full"
            style={{ filter: 'invert(1) hue-rotate(180deg)' }}
          />
        </div>
        {embed.description && (
          <p className="px-4 pb-3 text-xs text-zinc-500 italic">{embed.description}</p>
        )}
      </div>
    );
  }

  if (embed.embedType === 'video' && !embed.url.includes('embed')) {
    return (
      <div className="w-full bg-[#0d0d0d] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800/30 bg-zinc-900/20">
          <span className="text-indigo-400">{EMBED_ICONS[embed.embedType]}</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
            {EMBED_LABELS[embed.embedType]}
          </span>
          {embed.title && (
            <span className="text-xs text-zinc-300 ml-2 truncate">{embed.title}</span>
          )}
        </div>
        <video
          src={embed.url}
          controls
          autoPlay={embed.autoplay}
          className="w-full"
          style={{ maxHeight: typeof resolvedHeight === 'number' ? `${resolvedHeight}px` : resolvedHeight }}
        />
        {embed.description && (
          <p className="px-4 py-3 text-xs text-zinc-500 italic">{embed.description}</p>
        )}
      </div>
    );
  }

  // Gist needs a special script-based embed
  if (embed.embedType === 'gist') {
    const gistMatch = embed.url.match(/gist\.github\.com\/([^/]+\/[a-f0-9]+)/);
    const gistId = gistMatch ? gistMatch[1] : '';
    return (
      <div className="w-full bg-[#0d0d0d] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
        <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/30 bg-zinc-900/20">
          <div className="flex items-center gap-2">
            <span className="text-indigo-400">{EMBED_ICONS[embed.embedType]}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
              {EMBED_LABELS[embed.embedType]}
            </span>
            {embed.title && (
              <span className="text-xs text-zinc-300 ml-2 truncate">{embed.title}</span>
            )}
          </div>
          <a
            href={embed.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
        <iframe
          srcDoc={`<html><head><style>body{margin:0;background:#0d0d0d;color:#e4e4e7;} .gist .gist-meta{display:none} .gist .blob-wrapper{border-radius:0} .gist .gist-file{border:none;margin:0}</style></head><body><script src="https://gist.github.com/${gistId}.js"></script></body></html>`}
          className="w-full border-0"
          style={{
            width: typeof width === 'number' ? `${width}px` : width,
            height: typeof resolvedHeight === 'number' ? `${resolvedHeight}px` : resolvedHeight,
          }}
          sandbox="allow-scripts allow-same-origin"
          title={embed.title || 'GitHub Gist'}
        />
        {embed.description && (
          <p className="px-4 py-3 text-xs text-zinc-500 italic">{embed.description}</p>
        )}
      </div>
    );
  }

  // For all iframe-based embeds (YouTube, Spotify, CodePen, etc.)
  return (
    <div className="w-full bg-[#0d0d0d] border border-zinc-800/40 rounded-2xl overflow-hidden shadow-lg shadow-black/20 transition-all duration-300 hover:border-zinc-700/50">
      {/* Header bar */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/30 bg-zinc-900/20">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400">{EMBED_ICONS[embed.embedType]}</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
            {EMBED_LABELS[embed.embedType]}
          </span>
          {embed.title && (
            <span className="text-xs text-zinc-300 ml-2 truncate">{embed.title}</span>
          )}
        </div>
        <a
          href={embed.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Open in new tab"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Thumbnail preview or loaded iframe */}
      {!showEmbed && embed.thumbnailUrl ? (
        <button
          onClick={() => setShowEmbed(true)}
          className="relative w-full group cursor-pointer"
          style={{ height: typeof resolvedHeight === 'number' ? `${resolvedHeight}px` : resolvedHeight }}
        >
          <img
            src={embed.thumbnailUrl}
            alt={embed.title || 'Preview'}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/30 transition-colors">
            <div className="w-16 h-16 rounded-full bg-indigo-600/90 flex items-center justify-center shadow-xl shadow-indigo-500/20 group-hover:scale-110 transition-transform">
              <Play size={28} className="text-white ml-1" />
            </div>
          </div>
        </button>
      ) : (
        <div className="relative" style={{ width: typeof width === 'number' ? `${width}px` : width }}>
          {!loaded && (
            <div
              className="absolute inset-0 bg-zinc-900 flex items-center justify-center"
              style={{ height: typeof resolvedHeight === 'number' ? `${resolvedHeight}px` : resolvedHeight }}
            >
              <div className="flex flex-col items-center gap-2 text-zinc-600">
                <div className="w-8 h-8 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Loading…</span>
              </div>
            </div>
          )}
          <iframe
            src={embedSrc}
            className="w-full border-0"
            style={{
              height: typeof resolvedHeight === 'number' ? `${resolvedHeight}px` : resolvedHeight,
              opacity: loaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            title={embed.title || EMBED_LABELS[embed.embedType]}
            onLoad={() => setLoaded(true)}
          />
        </div>
      )}

      {/* Description / caption */}
      {embed.description && (
        <p className="px-4 py-3 text-xs text-zinc-500 italic border-t border-zinc-800/20">
          {embed.description}
        </p>
      )}
    </div>
  );
};

export default EmbeddedObject;

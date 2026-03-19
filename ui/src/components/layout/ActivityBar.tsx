/**
 * ActivityBar — VS Code-style vertical icon button bar.
 *
 * Rendered to the far left of the application, before the sidebar.
 * Provides quick-access icon buttons for:
 *  1. Core screens (Chat is always first)
 *  2. Plugin-contributed top-level content screens
 *
 * Plugins register activity bar items via `api.ui.registerActivityBarItem()`
 * or declaratively in plugin.json under `ui.activityBarItems`.
 *
 * @module ui/src/components/layout/ActivityBar
 */

import { useCallback, useMemo } from 'react';

/**
 * A single activity bar item descriptor.
 */
export interface ActivityBarItem {
  /** Unique identifier (e.g. 'chat', 'plugin:alephnet:network') */
  id: string;
  /** Tooltip / accessible label */
  label: string;
  /** Emoji, single character, or SVG path to render as the icon */
  icon: string;
  /** The action to take: navigate to a tab, surface, or plugin screen */
  action: {
    /** 'tab' navigates to a tab by id, 'surface' opens a surface, 'plugin' opens a plugin page */
    type: 'tab' | 'surface' | 'plugin' | 'custom';
    /** Target id — tab id, surface id, or plugin name depending on type */
    target: string;
  };
  /** Optional sort order (lower = higher position). Default 100. */
  order?: number;
  /** Which plugin contributed this item (undefined for core items) */
  pluginName?: string;
}

interface ActivityBarProps {
  /** All activity bar items (core + plugin-contributed) */
  items: ActivityBarItem[];
  /** Currently active item id */
  activeItemId?: string;
  /** Called when an item is clicked */
  onItemClick: (item: ActivityBarItem) => void;
}

/**
 * Render an icon from a string descriptor.
 * Supports:
 *  - Emoji / single characters (rendered as-is)
 *  - `svg:...` prefix for inline SVG path data
 *  - `lucide:...` prefix for Lucide icon names (future)
 */
function ActivityIcon({ icon, label }: { icon: string; label: string }) {
  // SVG path data
  if (icon.startsWith('svg:')) {
    const pathData = icon.slice(4);
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label={label}
      >
        <path d={pathData} />
      </svg>
    );
  }

  // Emoji or character
  return (
    <span className="text-[18px] leading-none select-none" role="img" aria-label={label}>
      {icon}
    </span>
  );
}

export default function ActivityBar({ items, activeItemId, onItemClick }: ActivityBarProps) {
  // Sort items by order
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    [items]
  );

  const handleClick = useCallback(
    (item: ActivityBarItem) => {
      onItemClick(item);
    },
    [onItemClick]
  );

  return (
    <div
      className="flex flex-col items-center w-[48px] min-w-[48px] bg-[#0a0a0a] border-r border-zinc-800/60 py-2 gap-1 overflow-y-auto overflow-x-hidden flex-shrink-0"
      role="toolbar"
      aria-label="Activity Bar"
      aria-orientation="vertical"
    >
      {sortedItems.map((item) => {
        const isActive = activeItemId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => handleClick(item)}
            title={item.label}
            aria-label={item.label}
            aria-pressed={isActive}
            className={`
              relative flex items-center justify-center w-[40px] h-[40px] rounded-md
              transition-all duration-150 group
              ${isActive
                ? 'text-zinc-100 bg-zinc-700/50'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
              }
            `}
          >
            {/* Active indicator bar (left edge) */}
            {isActive && (
              <div className="absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-indigo-400 rounded-r" />
            )}
            <ActivityIcon icon={item.icon} label={item.label} />
          </button>
        );
      })}
    </div>
  );
}

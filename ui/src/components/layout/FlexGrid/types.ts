/**
 * FlexGrid Layout Types
 * 
 * A dynamic, AI-configurable layout system for Surface pages.
 * The AI assistant can describe layouts as a tree of rows and cells,
 * each with configurable flex sizing, gaps, alignment, and component placement.
 */

/** Alignment options for flex containers */
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
export type FlexDirection = 'row' | 'column';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';

/** Responsive breakpoint overrides */
export interface ResponsiveOverride {
  /** Minimum width in pixels for this breakpoint to apply */
  minWidth: number;
  /** Override properties at this breakpoint */
  flex?: number | string;
  span?: number;
  hidden?: boolean;
  order?: number;
  direction?: FlexDirection;
  columns?: number;
}

/** 
 * A cell within a flex-grid row. 
 * Each cell can host one or more surface components by name.
 */
export interface FlexGridCell {
  /** Unique cell ID */
  id: string;
  /** Flex grow/shrink factor, or a CSS flex shorthand like "0 0 300px" */
  flex?: number | string;
  /** Minimum width (CSS value) */
  minWidth?: string;
  /** Maximum width (CSS value) */
  maxWidth?: string;
  /** Min height (CSS value) */
  minHeight?: string;
  /** Max height (CSS value) */  
  maxHeight?: string;
  /** Fixed width (CSS value, overrides flex) */
  width?: string;
  /** Fixed height (CSS value) */
  height?: string;
  /** Component names placed in this cell (in render order) */
  components: string[];
  /** Custom CSS class names */
  className?: string;
  /** Padding (CSS value) */
  padding?: string;
  /** Cell alignment override */
  align?: FlexAlign;
  /** Render order (CSS order property) */
  order?: number;
  /** Whether cell scrolls overflow */
  overflow?: 'auto' | 'hidden' | 'visible' | 'scroll';
  /** Background color or gradient */
  background?: string;
  /** Border radius */
  borderRadius?: string;
  /** Responsive overrides keyed by breakpoint name */
  responsive?: ResponsiveOverride[];
}

/**
 * A row within the flex-grid layout.
 * Rows contain cells and can be nested.
 */
export interface FlexGridRow {
  /** Unique row ID */
  id: string;
  /** Direction of the row's flex layout */
  direction?: FlexDirection;
  /** Wrap behavior */
  wrap?: FlexWrap;
  /** Gap between cells (CSS value) */
  gap?: string;
  /** Flex grow factor for this row within its parent */
  flex?: number | string;
  /** Cross-axis alignment of cells */
  align?: FlexAlign;
  /** Main-axis justification of cells */
  justify?: FlexJustify;
  /** Min height (CSS value) */
  minHeight?: string;
  /** Max height (CSS value) */
  maxHeight?: string;
  /** Height (CSS value) */
  height?: string;
  /** Child cells */
  cells: FlexGridCell[];
  /** Custom CSS class names */
  className?: string;
  /** Padding around the row */
  padding?: string;
  /** Background */
  background?: string;
  /** Responsive overrides */
  responsive?: ResponsiveOverride[];
}

/**
 * The top-level layout configuration for a surface.
 * Can be set/modified dynamically by the AI assistant.
 */
export interface FlexGridLayout {
  /** Layout type discriminator */
  type: 'flex-grid';
  /** Direction of the top-level container */
  direction?: FlexDirection;
  /** Gap between rows (CSS value) */
  gap?: string;
  /** Padding around the container (CSS value) */
  padding?: string;
  /** Cross-axis alignment */
  align?: FlexAlign;
  /** Main-axis justification */
  justify?: FlexJustify;
  /** Rows in the layout */
  rows: FlexGridRow[];
  /** Global max-width constraint (CSS value) */
  maxWidth?: string;
  /** Container min-height */
  minHeight?: string;
  /** Background color/gradient for the surface container */
  background?: string;
  /** Custom CSS class names for the container */
  className?: string;
}

/** 
 * Legacy layout types (backward compatible with existing surfaces).
 * When layout is 'vertical' | 'horizontal' | 'grid', the old rendering is used.
 * When layout is a FlexGridLayout object, the new system is used.
 */
export type SurfaceLayoutConfig = 'vertical' | 'horizontal' | 'grid' | FlexGridLayout;

/**
 * Preset layout templates that the AI can reference by name
 */
export type LayoutPreset = 
  | 'dashboard'      // Header row + 3-column main + footer
  | 'sidebar-left'   // Left sidebar + main content
  | 'sidebar-right'  // Main content + right sidebar
  | 'holy-grail'     // Header + [left sidebar | content | right sidebar] + footer
  | 'split-view'     // Two equal columns
  | 'masonry-3'      // 3-column grid-like layout
  | 'stack'           // Simple vertical stack (same as 'vertical')
  | 'hero-content'   // Full-width hero + content below
  | 'kanban';         // Multiple equal-width scrollable columns

/** Generate a preset layout configuration */
export function getPresetLayout(preset: LayoutPreset): FlexGridLayout {
  switch (preset) {
    case 'dashboard':
      return {
        type: 'flex-grid',
        direction: 'column',
        gap: '0',
        rows: [
          { id: 'header', direction: 'row', gap: '16px', flex: '0 0 auto', cells: [{ id: 'header-content', flex: 1, components: [] }], minHeight: '60px' },
          { id: 'main', direction: 'row', gap: '16px', flex: 1, cells: [
            { id: 'col-1', flex: 1, components: [], minWidth: '200px' },
            { id: 'col-2', flex: 1, components: [], minWidth: '200px' },
            { id: 'col-3', flex: 1, components: [], minWidth: '200px' },
          ]},
          { id: 'footer', direction: 'row', gap: '16px', flex: '0 0 auto', cells: [{ id: 'footer-content', flex: 1, components: [] }], minHeight: '48px' },
        ]
      };

    case 'sidebar-left':
      return {
        type: 'flex-grid',
        direction: 'row',
        gap: '0',
        rows: [
          { id: 'layout', direction: 'row', gap: '16px', flex: 1, cells: [
            { id: 'sidebar', flex: '0 0 280px', components: [], overflow: 'auto' },
            { id: 'content', flex: 1, components: [], overflow: 'auto' },
          ]}
        ]
      };

    case 'sidebar-right':
      return {
        type: 'flex-grid',
        direction: 'row',
        gap: '0',
        rows: [
          { id: 'layout', direction: 'row', gap: '16px', flex: 1, cells: [
            { id: 'content', flex: 1, components: [], overflow: 'auto' },
            { id: 'sidebar', flex: '0 0 280px', components: [], overflow: 'auto' },
          ]}
        ]
      };

    case 'holy-grail':
      return {
        type: 'flex-grid',
        direction: 'column',
        gap: '0',
        rows: [
          { id: 'header', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'header-content', flex: 1, components: [] }], minHeight: '56px' },
          { id: 'body', direction: 'row', gap: '16px', flex: 1, cells: [
            { id: 'left-sidebar', flex: '0 0 240px', components: [], overflow: 'auto' },
            { id: 'main-content', flex: 1, components: [], overflow: 'auto' },
            { id: 'right-sidebar', flex: '0 0 240px', components: [], overflow: 'auto' },
          ]},
          { id: 'footer', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'footer-content', flex: 1, components: [] }], minHeight: '48px' },
        ]
      };

    case 'split-view':
      return {
        type: 'flex-grid',
        direction: 'row',
        gap: '0',
        rows: [
          { id: 'split', direction: 'row', gap: '1px', flex: 1, cells: [
            { id: 'left', flex: 1, components: [], overflow: 'auto' },
            { id: 'right', flex: 1, components: [], overflow: 'auto' },
          ]}
        ]
      };

    case 'masonry-3':
      return {
        type: 'flex-grid',
        direction: 'column',
        gap: '16px',
        padding: '16px',
        rows: [
          { id: 'grid', direction: 'row', gap: '16px', flex: 1, wrap: 'wrap', cells: [
            { id: 'card-1', flex: '1 1 300px', components: [], minWidth: '280px' },
            { id: 'card-2', flex: '1 1 300px', components: [], minWidth: '280px' },
            { id: 'card-3', flex: '1 1 300px', components: [], minWidth: '280px' },
          ]}
        ]
      };

    case 'hero-content':
      return {
        type: 'flex-grid',
        direction: 'column',
        gap: '0',
        rows: [
          { id: 'hero', direction: 'row', flex: '0 0 auto', gap: '0', cells: [{ id: 'hero-content', flex: 1, components: [], minHeight: '300px' }] },
          { id: 'content', direction: 'row', flex: 1, gap: '16px', cells: [{ id: 'main', flex: 1, components: [], padding: '24px' }] },
        ]
      };

    case 'kanban':
      return {
        type: 'flex-grid',
        direction: 'row',
        gap: '12px',
        padding: '12px',
        rows: [
          { id: 'columns', direction: 'row', gap: '12px', flex: 1, cells: [
            { id: 'col-1', flex: '0 0 300px', components: [], overflow: 'auto' },
            { id: 'col-2', flex: '0 0 300px', components: [], overflow: 'auto' },
            { id: 'col-3', flex: '0 0 300px', components: [], overflow: 'auto' },
            { id: 'col-4', flex: '0 0 300px', components: [], overflow: 'auto' },
          ]}
        ]
      };

    case 'stack':
    default:
      return {
        type: 'flex-grid',
        direction: 'column',
        gap: '16px',
        padding: '16px',
        rows: [
          { id: 'stack', direction: 'column', gap: '16px', flex: 1, cells: [
            { id: 'main', flex: 1, components: [] },
          ]}
        ]
      };
  }
}

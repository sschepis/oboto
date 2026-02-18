import React, { useMemo } from 'react';
import type { FlexGridLayout, FlexGridRow as FlexGridRowType, FlexGridCell as FlexGridCellType, FlexAlign, FlexJustify, FlexDirection, FlexWrap } from './types';

// ─── Utility mappers ─────────────────────────────────────────────

const alignMap: Record<FlexAlign, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const justifyMap: Record<FlexJustify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

// ─── Cell ────────────────────────────────────────────────────────

interface CellProps {
  cell: FlexGridCellType;
  /** Render function for placing components inside a cell */
  renderComponents: (componentNames: string[]) => React.ReactNode;
}

export const FlexGridCellView: React.FC<CellProps> = ({ cell, renderComponents }) => {
  const style = useMemo<React.CSSProperties>(() => {
    const s: React.CSSProperties = {};

    // Flex sizing
    if (cell.width) {
      s.flex = `0 0 ${cell.width}`;
      s.width = cell.width;
    } else if (cell.flex !== undefined) {
      if (typeof cell.flex === 'number') {
        s.flex = `${cell.flex} ${cell.flex} 0%`;
      } else {
        s.flex = cell.flex;
      }
    } else {
      s.flex = '1 1 0%';
    }

    if (cell.minWidth) s.minWidth = cell.minWidth;
    if (cell.maxWidth) s.maxWidth = cell.maxWidth;
    if (cell.minHeight) s.minHeight = cell.minHeight;
    if (cell.maxHeight) s.maxHeight = cell.maxHeight;
    if (cell.height) s.height = cell.height;
    if (cell.align) s.alignSelf = alignMap[cell.align];
    if (cell.order !== undefined) s.order = cell.order;
    if (cell.background) s.background = cell.background;

    if (cell.overflow) {
      s.overflow = cell.overflow;
    }

    // Default card-like dark styling when no explicit background
    if (!cell.background) {
      s.background = 'rgba(17, 17, 20, 0.7)';
    }
    if (!cell.borderRadius) {
      s.borderRadius = '10px';
    } else {
      s.borderRadius = cell.borderRadius;
    }
    // Default padding if none specified
    if (!cell.padding) {
      s.padding = '16px';
    } else {
      s.padding = cell.padding;
    }

    return s;
  }, [cell]);

  // Don't render empty cells at all — they create the big empty spaces
  if (cell.components.length === 0) {
    return null;
  }

  return (
    <div
      data-cell-id={cell.id}
      className={`flex flex-col min-w-0 border border-zinc-800/50 overflow-auto ${cell.className || ''}`}
      style={style}
    >
      {renderComponents(cell.components)}
    </div>
  );
};

// ─── Row ─────────────────────────────────────────────────────────

interface RowProps {
  row: FlexGridRowType;
  renderComponents: (componentNames: string[]) => React.ReactNode;
}

export const FlexGridRowView: React.FC<RowProps> = ({ row, renderComponents }) => {
  // Check if any cell has components — if none do, collapse the row
  const hasContent = row.cells.some(cell => cell.components.length > 0);

  const style = useMemo<React.CSSProperties>(() => {
    const s: React.CSSProperties = {
      display: 'flex',
      flexDirection: (row.direction || 'row') as FlexDirection,
    };

    if (row.wrap) {
      const wrapMap: Record<FlexWrap, string> = { nowrap: 'nowrap', wrap: 'wrap', 'wrap-reverse': 'wrap-reverse' };
      s.flexWrap = wrapMap[row.wrap] as React.CSSProperties['flexWrap'];
    }

    // Default gap between cells
    s.gap = row.gap || '12px';
    
    if (row.flex !== undefined) {
      if (typeof row.flex === 'number') {
        s.flex = `${row.flex} ${row.flex} 0%`;
      } else {
        s.flex = row.flex;
      }
    }

    if (row.align) s.alignItems = alignMap[row.align];
    if (row.justify) s.justifyContent = justifyMap[row.justify];
    if (row.minHeight) s.minHeight = row.minHeight;
    if (row.maxHeight) s.maxHeight = row.maxHeight;
    if (row.height) s.height = row.height;
    if (row.padding) s.padding = row.padding;
    if (row.background) s.background = row.background;

    return s;
  }, [row]);

  // Collapse empty rows to avoid blank space
  if (!hasContent) {
    return null;
  }

  return (
    <div
      data-row-id={row.id}
      className={`w-full min-w-0 ${row.className || ''}`}
      style={style}
    >
      {row.cells.map(cell => (
        <FlexGridCellView
          key={cell.id}
          cell={cell}
          renderComponents={renderComponents}
        />
      ))}
    </div>
  );
};

// ─── Container ───────────────────────────────────────────────────

interface ContainerProps {
  layout: FlexGridLayout;
  /** Render function: given component names, return rendered components */
  renderComponents: (componentNames: string[]) => React.ReactNode;
  /** Extra CSS class on container */
  className?: string;
}

export const FlexGridContainer: React.FC<ContainerProps> = ({ layout, renderComponents, className }) => {
  const style = useMemo<React.CSSProperties>(() => {
    const s: React.CSSProperties = {
      display: 'flex',
      flexDirection: (layout.direction || 'column') as FlexDirection,
      flex: '1 1 0%',
      minHeight: 0,
    };

    // Default gap and padding for a polished look
    s.gap = layout.gap || '12px';
    s.padding = layout.padding || '12px';
    if (layout.align) s.alignItems = alignMap[layout.align];
    if (layout.justify) s.justifyContent = justifyMap[layout.justify];
    if (layout.maxWidth) s.maxWidth = layout.maxWidth;
    if (layout.minHeight) s.minHeight = layout.minHeight;
    if (layout.background) s.background = layout.background;

    return s;
  }, [layout]);

  return (
    <div
      data-layout-type="flex-grid"
      className={`overflow-auto w-full min-w-0 ${layout.className || ''} ${className || ''}`}
      style={style}
    >
      {layout.rows.map(row => (
        <FlexGridRowView
          key={row.id}
          row={row}
          renderComponents={renderComponents}
        />
      ))}
    </div>
  );
};

export default FlexGridContainer;

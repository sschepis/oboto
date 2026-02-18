export const SURFACE_TOOLS = [
    {
        type: "function",
        function: {
            name: "create_surface",
            description: "Create a new surface (dynamic UI page). Returns the surface ID. The surface starts as a blank page that components can be added to incrementally.",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Display name for the surface"
                    },
                    description: {
                        type: "string",
                        description: "Brief description of what this surface does"
                    },
                    layout: {
                        type: "string",
                        enum: ["vertical", "horizontal", "grid"],
                        description: "Layout mode for components. Default: vertical"
                    }
                },
                required: ["name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "update_surface_component",
            description: "Add or update a React component on a surface. Write the full JSX source for the component. The component will be compiled and rendered live in the browser. Available globals: React, useState, useEffect, useRef, useCallback, useMemo. Components should use Tailwind CSS classes for styling.",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID to update"
                    },
                    component_name: {
                        type: "string",
                        description: "PascalCase name for the component (e.g. SalesChart)"
                    },
                    jsx_source: {
                        type: "string",
                        description: "Full JSX source code for the component. Must export default a React function component."
                    },
                    props: {
                        type: "object",
                        description: "Optional props to pass to the component"
                    },
                    order: {
                        type: "number",
                        description: "Display order (0-based). Components are sorted by order."
                    }
                },
                required: ["surface_id", "component_name", "jsx_source"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "remove_surface_component",
            description: "Remove a component from a surface",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID"
                    },
                    component_name: {
                        type: "string",
                        description: "Name of the component to remove"
                    }
                },
                required: ["surface_id", "component_name"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_surfaces",
            description: "List all surfaces in the current workspace",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_surface",
            description: "Delete a surface and all its components",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID to delete"
                    }
                },
                required: ["surface_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "open_surface",
            description: "Open an existing surface in the UI. Use this when the user asks to see or open a specific surface.",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID to open"
                    }
                },
                required: ["surface_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "capture_surface",
            description: "Capture a screenshot of a specific surface (internal UI panel). Returns the screenshot as an image.",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The ID of the surface to capture"
                    }
                },
                required: ["surface_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "configure_surface_layout",
            description: `Configure the layout of a surface using the flex-grid system. You can use a preset name or provide a custom FlexGridLayout object.

PRESETS: 'dashboard', 'sidebar-left', 'sidebar-right', 'holy-grail', 'split-view', 'masonry-3', 'stack', 'hero-content', 'kanban'

CUSTOM LAYOUT: Provide a FlexGridLayout object with rows containing cells. Each cell has an 'id' and a 'components' array of component names to place there.

Example custom layout:
{
  "type": "flex-grid",
  "direction": "column",
  "gap": "16px",
  "rows": [
    { "id": "top", "direction": "row", "gap": "16px", "flex": "0 0 auto", "cells": [
      { "id": "header", "flex": 1, "components": ["HeaderWidget"] }
    ]},
    { "id": "main", "direction": "row", "gap": "16px", "flex": 1, "cells": [
      { "id": "sidebar", "flex": "0 0 280px", "components": ["NavMenu"], "overflow": "auto" },
      { "id": "content", "flex": 1, "components": ["MainContent", "DataTable"], "overflow": "auto" }
    ]}
  ]
}`,
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID to configure"
                    },
                    preset: {
                        type: "string",
                        enum: ["dashboard", "sidebar-left", "sidebar-right", "holy-grail", "split-view", "masonry-3", "stack", "hero-content", "kanban"],
                        description: "Use a named preset layout. Mutually exclusive with 'layout'."
                    },
                    layout: {
                        type: "object",
                        description: "Custom FlexGridLayout object. Must include type:'flex-grid' and rows array. Mutually exclusive with 'preset'."
                    }
                },
                required: ["surface_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "place_component_in_cell",
            description: "Place a component into a specific cell within a flex-grid layout. The surface must already have a flex-grid layout configured.",
            parameters: {
                type: "object",
                properties: {
                    surface_id: {
                        type: "string",
                        description: "The surface ID"
                    },
                    component_name: {
                        type: "string",
                        description: "PascalCase name of the component to place"
                    },
                    cell_id: {
                        type: "string",
                        description: "The cell ID in the flex-grid layout where the component should be placed"
                    }
                },
                required: ["surface_id", "component_name", "cell_id"]
            }
        }
    }
];

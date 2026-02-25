// Tool definitions for the AI assistant
// This module contains all the built-in tool schemas used by the AI
// REFACTORED: Now exports from individual definition files
// NOTE: Extracted plugin tools (browser, web, firecrawl, openclaw, workflow-surface,
//       persona, ui-style, math, image, embed, tts, chrome-ext, workflow) are now
//       registered by their respective plugins via _pluginSchemas.

export { CORE_TOOLS } from './definitions/core-tools.mjs';
export { CUSTOM_TOOL_MANAGEMENT, WORKSPACE_TOOLS } from './definitions/custom-tool-management.mjs';
export { STRUCTURED_DEV_TOOLS } from './definitions/structured-dev-tools.mjs';
export { RECURSIVE_TOOLS } from './definitions/recursive-tools.mjs';
export { FILE_TOOLS } from './definitions/file-tools.mjs';
export { DESKTOP_TOOLS } from './definitions/desktop-tools.mjs';
export { SHELL_TOOLS } from './definitions/shell-tools.mjs';
export { ASYNC_TASK_TOOLS } from './definitions/async-task-tools.mjs';
export { SURFACE_TOOLS } from './definitions/surface-tools.mjs';
export { SKILL_TOOLS } from './definitions/skill-tools.mjs';

import { CORE_TOOLS } from './definitions/core-tools.mjs';
import { CUSTOM_TOOL_MANAGEMENT, WORKSPACE_TOOLS } from './definitions/custom-tool-management.mjs';
import { STRUCTURED_DEV_TOOLS } from './definitions/structured-dev-tools.mjs';
import { RECURSIVE_TOOLS } from './definitions/recursive-tools.mjs';
import { FILE_TOOLS } from './definitions/file-tools.mjs';
import { DESKTOP_TOOLS } from './definitions/desktop-tools.mjs';
import { SHELL_TOOLS } from './definitions/shell-tools.mjs';
import { ASYNC_TASK_TOOLS } from './definitions/async-task-tools.mjs';
import { SURFACE_TOOLS } from './definitions/surface-tools.mjs';
import { SKILL_TOOLS } from './definitions/skill-tools.mjs';

export const TOOLS = [
    ...CORE_TOOLS,
    ...CUSTOM_TOOL_MANAGEMENT,
    ...WORKSPACE_TOOLS,
    ...STRUCTURED_DEV_TOOLS,
    ...RECURSIVE_TOOLS,
    ...FILE_TOOLS,
    ...DESKTOP_TOOLS,
    ...SHELL_TOOLS,
    ...ASYNC_TASK_TOOLS,
    ...SURFACE_TOOLS,
    ...SKILL_TOOLS
];

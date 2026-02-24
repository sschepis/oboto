// Tool definitions for the AI assistant
// This module contains all the built-in tool schemas used by the AI
// REFACTORED: Now exports from individual definition files

export { CORE_TOOLS } from './definitions/core-tools.mjs';
export { WORKFLOW_TOOLS, RECOVERY_TOOLS } from './definitions/workflow-tools.mjs';
export { ENHANCEMENT_TOOLS } from './definitions/enhancement-tools.mjs';
export { TTS_TOOLS } from './definitions/tts-tools.mjs';
export { CUSTOM_TOOL_MANAGEMENT, WORKSPACE_TOOLS } from './definitions/custom-tool-management.mjs';
export { STRUCTURED_DEV_TOOLS } from './definitions/structured-dev-tools.mjs';
export { RECURSIVE_TOOLS } from './definitions/recursive-tools.mjs';
export { WEB_TOOLS } from './definitions/web-tools.mjs';
export { FILE_TOOLS } from './definitions/file-tools.mjs';
export { DESKTOP_TOOLS } from './definitions/desktop-tools.mjs';
export { SHELL_TOOLS } from './definitions/shell-tools.mjs';
export { ASYNC_TASK_TOOLS } from './definitions/async-task-tools.mjs';
export { OPENCLAW_TOOLS } from './definitions/openclaw-tools.mjs';
export { SURFACE_TOOLS } from './definitions/surface-tools.mjs';
export { WORKFLOW_SURFACE_TOOLS } from './definitions/workflow-surface-tools.mjs';
export { PERSONA_TOOLS } from './definitions/persona-tools.mjs';
export { SKILL_TOOLS } from './definitions/skill-tools.mjs';

export { BROWSER_TOOLS } from './definitions/browser-tools.mjs';
export { CHROME_EXT_TOOLS } from './definitions/chrome-ext-tools.mjs';
export { UI_STYLE_TOOLS } from './definitions/ui-style-tools.mjs';
export { MATH_TOOLS } from './definitions/math-tools.mjs';
export { IMAGE_TOOLS } from './definitions/image-tools.mjs';
export { EMBED_TOOLS } from './definitions/embed-tools.mjs';

import { CORE_TOOLS } from './definitions/core-tools.mjs';
import { WORKFLOW_TOOLS, RECOVERY_TOOLS } from './definitions/workflow-tools.mjs';
import { ENHANCEMENT_TOOLS } from './definitions/enhancement-tools.mjs';
import { TTS_TOOLS } from './definitions/tts-tools.mjs';
import { CUSTOM_TOOL_MANAGEMENT, WORKSPACE_TOOLS } from './definitions/custom-tool-management.mjs';
import { STRUCTURED_DEV_TOOLS } from './definitions/structured-dev-tools.mjs';
import { RECURSIVE_TOOLS } from './definitions/recursive-tools.mjs';
import { WEB_TOOLS } from './definitions/web-tools.mjs';
import { FILE_TOOLS } from './definitions/file-tools.mjs';
import { DESKTOP_TOOLS } from './definitions/desktop-tools.mjs';
import { SHELL_TOOLS } from './definitions/shell-tools.mjs';
import { ASYNC_TASK_TOOLS } from './definitions/async-task-tools.mjs';
import { BROWSER_TOOLS } from './definitions/browser-tools.mjs';
import { CHROME_EXT_TOOLS } from './definitions/chrome-ext-tools.mjs';
import { SURFACE_TOOLS } from './definitions/surface-tools.mjs';
import { WORKFLOW_SURFACE_TOOLS } from './definitions/workflow-surface-tools.mjs';
import { PERSONA_TOOLS } from './definitions/persona-tools.mjs';
import { SKILL_TOOLS } from './definitions/skill-tools.mjs';
import { UI_STYLE_TOOLS } from './definitions/ui-style-tools.mjs';
import { MATH_TOOLS } from './definitions/math-tools.mjs';
import { IMAGE_TOOLS } from './definitions/image-tools.mjs';
import { EMBED_TOOLS } from './definitions/embed-tools.mjs';

export const TOOLS = [
    ...CORE_TOOLS,
    ...WORKFLOW_TOOLS,
    ...RECOVERY_TOOLS,
    ...ENHANCEMENT_TOOLS,
    ...TTS_TOOLS,
    ...CUSTOM_TOOL_MANAGEMENT,
    ...WORKSPACE_TOOLS,
    ...STRUCTURED_DEV_TOOLS,
    ...RECURSIVE_TOOLS,
    ...WEB_TOOLS,
    ...FILE_TOOLS,
    ...DESKTOP_TOOLS,
    ...SHELL_TOOLS,
    ...ASYNC_TASK_TOOLS,
    ...BROWSER_TOOLS,
    ...CHROME_EXT_TOOLS,
    ...SURFACE_TOOLS,
    ...WORKFLOW_SURFACE_TOOLS,
    ...PERSONA_TOOLS,
    ...SKILL_TOOLS,
    ...UI_STYLE_TOOLS,
    ...MATH_TOOLS,
    ...IMAGE_TOOLS,
    ...EMBED_TOOLS
];

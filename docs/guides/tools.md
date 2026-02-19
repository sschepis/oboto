# Tools Reference

Robodev comes with a comprehensive suite of tools categorized by function.

## 1. File System Operations
**Source:** `src/tools/file-tools.mjs`

| Tool | Description |
|---|---|
| `read_file` | Read content of a file. |
| `write_file` | Write content to a file (create or overwrite). |
| `edit_file` | Apply surgical edits to a file using string replacement. |
| `list_files` | List directory contents (recursive support). |
| `delete_file` | Delete a file or directory. |
| `move_file` | Move or rename a file or directory. |
| `search_files` | Search for files matching a pattern. |
| `get_file_info` | Get metadata about a file. |

## 2. System Operations
**Source:** `src/tools/shell-tools.mjs`, `src/tools/definitions/core-tools.mjs`

| Tool | Description |
|---|---|
| `run_command` | Execute a shell command in the terminal. |
| `execute_javascript` | Run JavaScript code in a sandboxed VM. |
| `execute_npm_function` | Execute a specific function from an npm package. |
| `fetch_url` | Fetch content from a URL (GET request). |

## 3. Web & Browser
**Source:** `src/tools/definitions/browser-tools.mjs`, `src/tools/definitions/web-tools.mjs`, `src/tools/definitions/firecrawl-tools.mjs`

| Tool | Description |
|---|---|
| `search_web` | Perform a Google search. |
| `browse_open` | Open a URL in a headless browser (Puppeteer). |
| `browse_act` | Interact with a page (click, type, scroll). |
| `browse_screenshot` | Capture a screenshot of the current page. |
| `firecrawl_scrape` | Scrape content from a URL using Firecrawl. |
| `firecrawl_crawl` | Crawl a website using Firecrawl. |

## 4. Desktop Automation
**Source:** `src/tools/definitions/desktop-tools.mjs`

| Tool | Description |
|---|---|
| `desktop_click` | Simulate a mouse click at coordinates. |
| `desktop_type` | Simulate keyboard typing. |
| `desktop_screenshot` | Take a screenshot of the entire desktop. |
| `desktop_locate` | Find an image on the screen. |

## 5. Structured Development
**Source:** `src/tools/definitions/structured-dev-tools.mjs`

| Tool | Description |
|---|---|
| `read_manifest` | Read the `SYSTEM_MAP.md` manifest. |
| `init_structured_dev` | Initialize the structured development framework. |
| `submit_technical_design` | Propose a new feature for the registry. |
| `approve_design` | Approve a feature for development. |
| `lock_interfaces` | Lock API signatures for a feature. |
| `submit_critique` | Submit a code review critique. |
| `visualize_architecture` | Generate C4 architecture diagrams. |
| `create_implementation_plan` | Generate an execution plan from the manifest. |

## 6. UI & Surfaces
**Source:** `src/tools/definitions/surface-tools.mjs`, `src/tools/definitions/ui-style-tools.mjs`

| Tool | Description |
|---|---|
| `create_surface` | Create a new dynamic UI surface (dashboard/panel). |
| `update_surface_component` | Add or update a React component on a surface. |
| `remove_surface_component` | Remove a component from a surface. |
| `list_surfaces` | List all active surfaces. |
| `delete_surface` | Delete a surface. |
| `set_theme` | Change the UI theme. |
| `get_theme` | Get current theme settings. |

## 7. Workflow Management
**Source:** `src/tools/definitions/workflow-tools.mjs`

| Tool | Description |
|---|---|
| `create_workflow` | Create a new reusable workflow definition. |
| `list_workflows` | List available workflows. |
| `execute_workflow` | Run a workflow instance. |
| `get_workflow_status` | Check the status of a running workflow. |

## 8. Skills & Knowledge
**Source:** `src/tools/definitions/skill-tools.mjs`, `src/tools/definitions/math-tools.mjs`

| Tool | Description |
|---|---|
| `list_skills` | List available skills in the `skills/` directory. |
| `read_skill` | Read the definition of a specific skill. |
| `use_skill` | Execute a skill. |
| `evaluate_math` | Evaluate a mathematical expression. |
| `unit_conversion` | Convert units. |

## 9. Background Tasks & Scheduling
**Source:** `src/tools/definitions/async-task-tools.mjs`

See [Multi-Agent Architecture](../architecture/multi-agent.md) for full details.

| Tool | Description |
|---|---|
| `spawn_background_task` | Spawn a new background AI task. Returns a task ID immediately. |
| `check_task_status` | Check status and result of a background task by ID. |
| `list_background_tasks` | List all background tasks, optionally filtered by status. |
| `cancel_background_task` | Cancel a running or queued task. |
| `get_task_output` | Get the real-time output log of a background task. |
| `wait_for_task` | Block until a task completes (configurable timeout). |
| `create_recurring_task` | Create a task that runs on a recurring schedule. |
| `list_recurring_tasks` | List all recurring task schedules. |
| `manage_recurring_task` | Pause, resume, delete, or trigger a recurring schedule. |
| `ask_blocking_question` | Ask the user a blocking question (pauses the agent loop until answered). |

## 10. Conversation Management
**Source:** `src/tools/definitions/core-tools.mjs`

See [Multi-Agent Architecture](../architecture/multi-agent.md) for full details.

| Tool | Description |
|---|---|
| `report_to_parent` | Report findings from a child conversation back to the default `chat` conversation. |

Conversation management (create, switch, delete, list) is handled via WebSocket messages rather than tools—see the [Multi-Agent Architecture](../architecture/multi-agent.md#api) for the message protocol.

## 11. Integration & MCP
**Source:** `src/tools/definitions/mcp-tools.mjs`, `src/tools/definitions/openclaw-tools.mjs`

| Tool | Description |
|---|---|
| `mcp_list_servers` | List connected MCP servers. |
| `mcp_add_server` | Connect to a new MCP server. |
| `delegate_to_openclaw` | Delegate a task to the OpenClaw agent. |
| `mcp_{server}_{tool}` | Dynamically generated tools from connected servers. |

## 12. Persona & TTS
**Source:** `src/tools/definitions/persona-tools.mjs`, `src/tools/definitions/tts-tools.mjs`

| Tool | Description |
|---|---|
| `set_persona` | Change the active persona. |
| `get_persona` | Get current persona details. |
| `speak_text` | Convert text to speech. |

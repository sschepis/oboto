# Structured Development Architecture

Oboto includes a robust "Structured Development" framework (`src/structured-dev`) designed to manage complex software projects through a disciplined, manifest-driven approach.

## 1. Core Concept

Instead of ad-hoc coding, Oboto encourages maintaining a "Living Manifest" (`SYSTEM_MAP.md`) that serves as the single source of truth for the project's state. All architectural decisions, feature statuses, and invariants are recorded here.

## 2. The Living Manifest (`SYSTEM_MAP.md`)

This markdown file is automatically managed by the system and contains:
1.  **Global Invariants**: Fundamental rules (e.g., "No external math libs").
2.  **Feature Registry**: A table tracking every feature's status (Discovery, Interface, Implementation, Locked).
3.  **Dependency Graph**: Explicit relationships between features.
4.  **State Snapshots**: A log of major architectural changes.

## 3. Key Components

### `ManifestManager` (`manifest-manager.mjs`)
The CRUD interface for `SYSTEM_MAP.md`.
*   **Initialization**: Creates the manifest template and `.cursorrules`.
*   **Updates**: safely modifies sections (Invariants, Registry) while preserving history.
*   **Snapshots**: Creates backups of the manifest state in `.snapshots/`.

### `ImplementationPlanner` (`implementation-planner.mjs`)
Analyzes the manifest to generate actionable execution plans.
*   **Dependency Resolution**: Uses topological sorting to determine the optimal order of tasks.
*   **Parallel Execution**: Groups independent tasks into stages for parallel implementation.
*   **Output**: Generates `implementation-plan.json`.

### `C4Visualizer` (`c4-visualizer.mjs`)
Generates architectural diagrams from the manifest.
*   **Format**: Outputs Mermaid.js C4 syntax.
*   **Scope**: Visualizes the System Context and Container diagrams based on registered features and their dependencies.

## 4. Workflow

1.  **Initialize**: Run `init_structured_dev` to create the manifest.
2.  **Define Features**: Use `submit_technical_design` to add features to the registry.
3.  **Visualize**: Run `visualize_architecture` to see the system structure.
4.  **Plan**: Run `create_implementation_plan` to generate a task list.
5.  **Execute**: The agent (or user) follows the plan, updating the manifest as features move from "Interface" to "Implementation" to "Completed".
6.  **Lock**: Use `lock_interfaces` to prevent accidental changes to stable APIs.

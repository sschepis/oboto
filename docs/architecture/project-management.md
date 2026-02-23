# Project Management Architecture

The Project Management module (`src/project-management/`) provides a structured framework for managing any type of project through a disciplined, manifest-driven approach. It extends the concepts from Structured Development to work with any project type—software, creative, research, events, or operational processes.

## 1. Core Concept

Instead of ad-hoc project tracking, this system maintains a **Living Project Manifest** (`PROJECT_MAP.md`) that serves as the single source of truth for the project's state. All goals, deliverables, tasks, risks, and decisions are recorded and tracked through this document.

The system enforces a **6-phase lifecycle** with validation gates between phases:

```
Ideation → Scoping → Planning → Execution → Review → Closure
```

## 2. The Living Manifest (`PROJECT_MAP.md`)

This markdown file is automatically managed by the system and contains:

### Section Structure

| Section | Purpose |
|---------|---------|
| **1. Project Meta** | ID, name, type, status, current phase, owner |
| **2. Goals & Success Criteria** | Measurable objectives with targets |
| **3. Constraints & Invariants** | Hard and soft limitations |
| **4. Deliverables Registry** | Outputs with phase assignments |
| **5. Task Breakdown** | Work items with assignments |
| **6. Risk Registry** | Identified risks with mitigation |
| **7. Decision Log** | Record of major decisions |
| **8. State Snapshots** | Change history |

### Example Manifest

```markdown
# Project Manifest (PROJECT_MAP.md)
Last Updated: 2026-02-21T20:00:00.000Z

## 1. Project Meta
| Field | Value |
|-------|-------|
| ID | PROJ-M2NEXR1A |
| Name | Website Redesign |
| Type | Software |
| Status | Active |
| Current Phase | Planning |
| Owner | @designer |
| Created | 2026-02-21T20:00:00.000Z |

## 2. Goals & Success Criteria
| ID | Goal | Metric | Target | Status |
|---|---|---|---|---|
| GOAL-001 | Improve conversion rate | Signups per 1000 visitors | 50 | Not Started |
| GOAL-002 | Reduce load time | Page load (seconds) | < 2s | Not Started |

## 3. Constraints & Invariants
| ID | Constraint | Type | Description |
|---|---|---|---|
| CONST-001 | Budget | Hard | $10,000 maximum |
| CONST-002 | Accessibility | Hard | WCAG 2.1 AA compliance |

## 4. Deliverables Registry
| ID | Deliverable | Owner | Phase | Status | Dependencies |
|---|---|---|---|---|---|
| DEL-001 | Design Mockups | @designer | Planning | In Progress | - |
| DEL-002 | Frontend Code | @developer | Execution | Not Started | DEL-001 |

## 5. Task Breakdown
| ID | Task | Deliverable | Assignee | Status | Priority |
|---|---|---|---|---|---|
| TASK-001 | Create wireframes | DEL-001 | @designer | Done | High |
| TASK-002 | Design homepage | DEL-001 | @designer | In Progress | High |

## 6. Risk Registry
| ID | Risk | Probability | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| RISK-001 | Scope creep | High | Medium | Weekly scope reviews | @pm |

## 7. Decision Log
| Date | Decision | Rationale | Impact |
|---|---|---|---|
| 2026-02-21 | Use React | Team expertise | DEL-002 |

## 8. State Snapshots
- [2026-02-21T20:00:00Z] Project initialized
- [2026-02-21T20:30:00Z] Phase transition: Ideation → Scoping
```

## 3. Key Components

### `ProjectManifest` (`project-manifest.mjs`)

The CRUD interface for `PROJECT_MAP.md`.

**Methods:**
- `initManifest(name, type, owner)` - Create new manifest
- `parseManifest()` - Parse into structured data
- `addGoal(id, goal, metric, target, status)` - Add/update goal
- `addDeliverable(id, name, owner, phase, status, deps)` - Add/update deliverable
- `addTask(id, name, deliverable, assignee, status, priority)` - Add/update task
- `addRisk(id, name, probability, impact, mitigation, owner)` - Add/update risk
- `addDecision(decision, rationale, impact)` - Log decision
- `createSnapshot(description)` - Create backup

### `PhaseController` (`phase-controller.mjs`)

Manages phase transitions with validation.

**Phase Flow:**
```
Ideation ──(submit_scope)──► Scoping ──(approve_scope)──► Planning
                                                             │
                                                      (lock_plan)
                                                             ▼
Closure ◄──(close_project)── Review ◄──(submit_review)── Execution
```

**Methods:**
- `getCurrentPhase()` - Get current phase
- `getNextPhases(phase)` - Get valid transitions
- `validateTransition(targetPhase)` - Validate transition
- `transitionTo(targetPhase, options)` - Execute transition
- `submitScope(document)` - Ideation → Scoping
- `approveScope(feedback)` - Scoping → Planning
- `lockPlan()` - Planning → Execution
- `submitReview(notes)` - Execution → Review
- `closeProject(retrospective)` - Review → Closure
- `getProgressReport()` - Get full status report

### `TaskScheduler` (`task-scheduler.mjs`)

Handles task planning and dependency resolution.

**Methods:**
- `createTaskBreakdown(options)` - Auto-generate tasks from deliverables
- `buildDependencyGraph()` - Build task dependency DAG
- `createExecutionPlan(options)` - Generate parallel execution stages
- `completeTask(taskId)` - Mark task done
- `startTask(taskId)` - Start a task
- `blockTask(taskId, reason)` - Block a task
- `getBurndownData()` - Get metrics for charts

### `TemplateRegistry` (`template-registry.mjs`)

Provides pre-defined project templates.

**Built-in Templates:**

| Template | Type | Description |
|----------|------|-------------|
| `software` | Software | Full SDLC with testing and deployment |
| `creative` | Creative | Content creation with drafting and editing |
| `research` | Research | Scientific method with hypothesis and analysis |
| `event` | Event | Event planning with logistics |
| `operational` | Operational | Process improvement with pilot phases |
| `general` | General | Basic 6-phase lifecycle |

**Methods:**
- `listTemplates()` - List all templates
- `getTemplate(id)` - Get template details
- `applyTemplate(id, options)` - Apply to current project
- `createFromTemplate(name, id, options)` - Create project from template
- `suggestTemplates(description)` - AI-suggest templates

### `SurfaceGenerator` (`surface-generator.mjs`)

Creates dynamic UI dashboards.

**Methods:**
- `createProjectDashboard(name)` - Full dashboard with widgets
- `createTaskBoard(name)` - Kanban-style task board
- `createTimelineView(name)` - Gantt-style timeline
- `addComponent(surfaceId, componentName)` - Add widget
- `createAllSurfaces(name)` - Create all standard surfaces

**Built-in Components:**
- `ProjectHeader` - Project name, type, status badge
- `PhaseTimeline` - Visual phase progress
- `TaskProgress` - Task completion stats
- `GoalsWidget` - Goals with status
- `RisksWidget` - Risk monitor
- `ActionButtons` - Phase transition buttons

### `ProjectBootstrapper` (`project-bootstrapper.mjs`)

Discovers existing docs and bootstraps the manifest.

**Methods:**
- `bootstrap(targetDir)` - Auto-discover and create manifest
- `findProjectDoc(dir)` - Find existing documentation
- `detectProjectType(content)` - Infer project type
- `extractGoals(parsed)` - Extract goals from doc
- `extractDeliverables(parsed)` - Extract deliverables

## 4. Tool Definitions

When integrating with the agent loop, register these tools:

### `init_project`
Initialize a new project with optional template.

```json
{
  "name": "init_project",
  "description": "Initialize a new project in the workspace",
  "parameters": {
    "project_name": { "type": "string", "required": true },
    "project_type": { "type": "string", "enum": ["Software", "Creative", "Research", "Event", "Operational", "General"] },
    "template": { "type": "string", "description": "Template ID to use" },
    "owner": { "type": "string", "default": "@user" }
  }
}
```

### `submit_scope`
Submit scope document to move from Ideation to Scoping.

```json
{
  "name": "submit_scope",
  "description": "Submit scope document for review (Ideation → Scoping)",
  "parameters": {
    "scope_document": { "type": "string", "required": true, "minLength": 100 }
  }
}
```

### `approve_scope`
Approve scope to move to Planning.

```json
{
  "name": "approve_scope",
  "description": "Approve scope and move to Planning phase",
  "parameters": {
    "feedback": { "type": "string" }
  }
}
```

### `lock_plan`
Lock the plan to begin Execution.

```json
{
  "name": "lock_plan",
  "description": "Lock the project plan and begin execution",
  "parameters": {}
}
```

### `add_goal`
Add a project goal.

```json
{
  "name": "add_goal",
  "description": "Add a goal to the project",
  "parameters": {
    "goal": { "type": "string", "required": true },
    "metric": { "type": "string", "required": true },
    "target": { "type": "string", "required": true }
  }
}
```

### `add_deliverable`
Add a deliverable.

```json
{
  "name": "add_deliverable",
  "description": "Add a deliverable to the project",
  "parameters": {
    "name": { "type": "string", "required": true },
    "owner": { "type": "string", "default": "@user" },
    "phase": { "type": "string", "default": "Execution" },
    "dependencies": { "type": "string" }
  }
}
```

### `add_task`
Add a task.

```json
{
  "name": "add_task",
  "description": "Add a task to the project",
  "parameters": {
    "name": { "type": "string", "required": true },
    "deliverable": { "type": "string", "required": true },
    "assignee": { "type": "string", "default": "@user" },
    "priority": { "type": "string", "enum": ["High", "Medium", "Low"], "default": "Medium" }
  }
}
```

### `complete_task`
Mark a task as complete.

```json
{
  "name": "complete_task",
  "description": "Mark a task as done",
  "parameters": {
    "task_id": { "type": "string", "required": true }
  }
}
```

### `create_task_plan`
Create execution plan with stages.

```json
{
  "name": "create_task_plan",
  "description": "Create a parallel execution plan for tasks",
  "parameters": {
    "num_parallel": { "type": "number", "default": 3 },
    "output_file": { "type": "string" }
  }
}
```

### `get_project_status`
Get comprehensive status report.

```json
{
  "name": "get_project_status",
  "description": "Get project status report",
  "parameters": {}
}
```

### `create_project_dashboard`
Create UI surface for project.

```json
{
  "name": "create_project_dashboard",
  "description": "Create a project dashboard surface",
  "parameters": {
    "project_name": { "type": "string" }
  }
}
```

## 5. Usage Example

### Programmatic Usage

```javascript
import { createProjectManagement } from './src/project-management/index.mjs';
import { SurfaceManager } from './src/surfaces/surface-manager.mjs';

// Create project management system
const surfaceManager = new SurfaceManager('/path/to/workspace');
const pm = createProjectManagement('/path/to/workspace', surfaceManager);

// Initialize from template
await pm.init('My Website', 'Software', 'software');

// Or bootstrap from existing docs
// await pm.bootstrap();

// Add goals
await pm.manifest.addGoal(null, 'Launch MVP', 'User signups', '100');

// Add deliverables
await pm.manifest.addDeliverable(null, 'Landing Page', '@designer', 'Execution');

// Check status
const status = await pm.status();
console.log(`Phase: ${status.phase.current}, Tasks: ${status.tasks.percentComplete}% complete`);

// Transition phases
await pm.submitScope('This project will create a modern website...');
await pm.approveScope('Looks good!');
await pm.lockPlan();

// Create dashboard
await pm.createDashboard('My Website');
```

### Agent Usage Flow

1. **User**: "Create a new software project called API Gateway"
2. **Agent**: Calls `init_project` with `template: "software"`
3. **Agent**: Calls `create_project_dashboard`
4. **User**: Sees PROJECT_MAP.md created and dashboard surface

1. **User**: "Add a goal to handle 1000 requests per second"
2. **Agent**: Calls `add_goal` with appropriate parameters
3. **User**: Goal appears in PROJECT_MAP.md

1. **User**: "We're ready to start development"
2. **Agent**: Validates phase requirements, calls `lock_plan`
3. **User**: Phase moves to Execution

## 6. Integration with Existing Systems

### Coexistence with SYSTEM_MAP.md

For software projects, both `PROJECT_MAP.md` (project lifecycle) and `SYSTEM_MAP.md` (code architecture) can coexist:

- **PROJECT_MAP.md** tracks high-level project deliverables, timelines, and stakeholders
- **SYSTEM_MAP.md** tracks technical features, interfaces, and code invariants

### Surface Integration

Project surfaces use the `surfaceApi` to read from `PROJECT_MAP.md` and update in real-time. Components can also trigger agent actions for phase transitions.

### Checkpoint Integration

The project state integrates with the TaskCheckpointManager for crash recovery. Project phase and task states are automatically checkpointed.

## 7. Phase Validation Rules

| Phase | Exit Requirements |
|-------|------------------|
| Ideation | At least 1 goal defined |
| Scoping | At least 1 deliverable defined |
| Planning | At least 3 tasks, all assigned |
| Execution | All high-priority tasks complete |
| Review | All deliverables completed or cancelled |
| Closure | N/A (terminal state) |

## 8. File Structure

```
src/project-management/
├── index.mjs              # Main exports and factory functions
├── project-manifest.mjs   # PROJECT_MAP.md CRUD operations
├── phase-controller.mjs   # Phase transition logic
├── task-scheduler.mjs     # Task planning and scheduling
├── template-registry.mjs  # Project templates
├── surface-generator.mjs  # Dashboard surface generation
└── project-bootstrapper.mjs # Bootstrap from existing docs
```

## 9. Best Practices

1. **Always read the manifest first** before making changes
2. **Use templates** for consistent project structure
3. **Define goals early** to guide scope and deliverables
4. **Track risks proactively** and update mitigations
5. **Log major decisions** for audit trail
6. **Use snapshots** before major changes
7. **Create dashboards** for visibility

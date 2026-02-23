// Surface Generator
// Creates dynamic UI surfaces for project dashboards and visualization
// Integrates with SurfaceManager to generate project-specific components

import { PROJECT_PHASES, PHASE_ORDER } from './project-manifest.mjs';

/**
 * Surface component templates for project management
 */
const COMPONENT_TEMPLATES = {
    // Project Dashboard Header
    ProjectHeader: `
export default function ProjectHeader() {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const parsed = parseProjectMeta(content);
      setProject(parsed);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function parseProjectMeta(content) {
    const meta = {};
    const metaMatch = content.match(/## 1\\. Project Meta([\\s\\S]*?)(?=## 2|$)/);
    if (!metaMatch) return meta;
    
    const lines = metaMatch[1].split('\\n').filter(l => l.trim().startsWith('|'));
    for (const line of lines) {
      const cols = line.split('|').map(c => c.trim()).filter(c => c);
      if (cols.length >= 2 && cols[0] !== 'Field' && !cols[0].includes('---')) {
        meta[cols[0].toLowerCase().replace(/\\s+/g, '_')] = cols[1];
      }
    }
    return meta;
  }

  if (loading) return <UI.Skeleton className="h-24 w-full" />;
  if (!project) return <div className="text-zinc-500">No project found</div>;

  const statusColors = {
    'Active': 'default',
    'Paused': 'secondary',
    'Completed': 'outline',
    'Archived': 'secondary'
  };

  return (
    <UI.Card>
      <UI.CardHeader className="flex flex-row items-center justify-between">
        <div>
          <UI.CardTitle className="text-xl">{project.name || 'Untitled Project'}</UI.CardTitle>
          <UI.CardDescription>{project.type || 'General'} • {project.owner}</UI.CardDescription>
        </div>
        <div className="flex gap-2">
          <UI.Badge variant={statusColors[project.status] || 'default'}>{project.status}</UI.Badge>
          <UI.Badge variant="outline">{project.current_phase}</UI.Badge>
        </div>
      </UI.CardHeader>
    </UI.Card>
  );
}
`,

    // Phase Timeline Component
    PhaseTimeline: `
export default function PhaseTimeline() {
  const [currentPhase, setCurrentPhase] = useState('Ideation');
  const phases = ['Ideation', 'Scoping', 'Planning', 'Execution', 'Review', 'Closure'];

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const match = content.match(/Current Phase \\|\\s*([^|]+)\\s*\\|/);
      if (match) setCurrentPhase(match[1].trim());
    });
  }, []);

  const currentIndex = phases.indexOf(currentPhase);

  return (
    <UI.Card>
      <UI.CardHeader>
        <UI.CardTitle className="text-sm font-medium">Phase Progress</UI.CardTitle>
      </UI.CardHeader>
      <UI.CardContent>
        <div className="flex items-center justify-between">
          {phases.map((phase, idx) => {
            const isComplete = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const isPending = idx > currentIndex;
            
            return (
              <div key={phase} className="flex flex-col items-center flex-1">
                <div className={\`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium \${
                  isComplete ? 'bg-green-600 text-white' :
                  isCurrent ? 'bg-blue-600 text-white' :
                  'bg-zinc-700 text-zinc-400'
                }\`}>
                  {isComplete ? <UI.Icons.Check className="w-4 h-4" /> : idx + 1}
                </div>
                <span className={\`text-xs mt-1 \${isCurrent ? 'text-blue-400 font-medium' : 'text-zinc-500'}\`}>
                  {phase}
                </span>
                {idx < phases.length - 1 && (
                  <div className={\`h-0.5 w-full mt-4 \${isComplete ? 'bg-green-600' : 'bg-zinc-700'}\`} />
                )}
              </div>
            );
          })}
        </div>
        <UI.Progress value={Math.round((currentIndex / (phases.length - 1)) * 100)} className="mt-4" />
      </UI.CardContent>
    </UI.Card>
  );
}
`,

    // Task Progress Widget
    TaskProgress: `
export default function TaskProgress() {
  const [tasks, setTasks] = useState({ total: 0, done: 0, inProgress: 0, blocked: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadTasks() {
    try {
      const content = await surfaceApi.readFile('PROJECT_MAP.md');
      const taskMatch = content.match(/## 5\\. Task Breakdown([\\s\\S]*?)(?=## 6|$)/);
      if (!taskMatch) return;

      const lines = taskMatch[1].split('\\n').filter(l => l.trim().startsWith('|') && !l.includes('Task') && !l.includes('---'));
      const statuses = lines.map(l => {
        const cols = l.split('|').map(c => c.trim());
        return cols[5] || '';
      });

      setTasks({
        total: statuses.length,
        done: statuses.filter(s => s === 'Done').length,
        inProgress: statuses.filter(s => s === 'In Progress').length,
        blocked: statuses.filter(s => s === 'Blocked').length
      });
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }

  if (loading) return <UI.Skeleton className="h-32 w-full" />;

  const percentComplete = tasks.total > 0 ? Math.round((tasks.done / tasks.total) * 100) : 0;

  return (
    <UI.Card>
      <UI.CardHeader>
        <UI.CardTitle className="text-sm font-medium">Task Progress</UI.CardTitle>
      </UI.CardHeader>
      <UI.CardContent>
        <div className="text-3xl font-bold">{percentComplete}%</div>
        <UI.Progress value={percentComplete} className="mt-2" />
        <div className="grid grid-cols-4 gap-2 mt-4 text-center text-xs">
          <div>
            <div className="text-2xl font-semibold">{tasks.total}</div>
            <div className="text-zinc-500">Total</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-green-500">{tasks.done}</div>
            <div className="text-zinc-500">Done</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-blue-500">{tasks.inProgress}</div>
            <div className="text-zinc-500">Active</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-red-500">{tasks.blocked}</div>
            <div className="text-zinc-500">Blocked</div>
          </div>
        </div>
      </UI.CardContent>
    </UI.Card>
  );
}
`,

    // Goals Widget
    GoalsWidget: `
export default function GoalsWidget() {
  const [goals, setGoals] = useState([]);

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const match = content.match(/## 2\\. Goals & Success Criteria([\\s\\S]*?)(?=## 3|$)/);
      if (!match) return;

      const lines = match[1].split('\\n').filter(l => l.trim().startsWith('|') && !l.includes('Goal') && !l.includes('---'));
      const parsed = lines.map(l => {
        const cols = l.split('|').map(c => c.trim()).filter(c => c);
        return { id: cols[0], goal: cols[1], metric: cols[2], target: cols[3], status: cols[4] };
      });
      setGoals(parsed);
    });
  }, []);

  if (goals.length === 0) {
    return (
      <UI.Card>
        <UI.CardHeader>
          <UI.CardTitle className="text-sm font-medium">Goals</UI.CardTitle>
        </UI.CardHeader>
        <UI.CardContent>
          <div className="text-zinc-500 text-sm">No goals defined yet</div>
        </UI.CardContent>
      </UI.Card>
    );
  }

  return (
    <UI.Card>
      <UI.CardHeader>
        <UI.CardTitle className="text-sm font-medium">Goals ({goals.length})</UI.CardTitle>
      </UI.CardHeader>
      <UI.CardContent className="space-y-2">
        {goals.map(g => (
          <div key={g.id} className="flex items-center justify-between p-2 rounded bg-zinc-800">
            <div>
              <div className="font-medium text-sm">{g.goal}</div>
              <div className="text-xs text-zinc-500">{g.metric}: {g.target}</div>
            </div>
            <UI.Badge variant={g.status === 'Met' ? 'default' : 'secondary'}>{g.status}</UI.Badge>
          </div>
        ))}
      </UI.CardContent>
    </UI.Card>
  );
}
`,

    // Risks Widget
    RisksWidget: `
export default function RisksWidget() {
  const [risks, setRisks] = useState([]);

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const match = content.match(/## 6\\. Risk Registry([\\s\\S]*?)(?=## 7|$)/);
      if (!match) return;

      const lines = match[1].split('\\n').filter(l => l.trim().startsWith('|') && !l.includes('Risk') && !l.includes('---'));
      const parsed = lines.map(l => {
        const cols = l.split('|').map(c => c.trim()).filter(c => c);
        return { id: cols[0], risk: cols[1], probability: cols[2], impact: cols[3], mitigation: cols[4] };
      });
      setRisks(parsed);
    });
  }, []);

  const highRisks = risks.filter(r => r.probability === 'High' || r.impact === 'High');

  return (
    <UI.Card>
      <UI.CardHeader className="flex flex-row items-center justify-between">
        <UI.CardTitle className="text-sm font-medium">Risk Monitor</UI.CardTitle>
        {highRisks.length > 0 && (
          <UI.Badge variant="destructive">{highRisks.length} High</UI.Badge>
        )}
      </UI.CardHeader>
      <UI.CardContent>
        {risks.length === 0 ? (
          <div className="text-zinc-500 text-sm">No risks tracked</div>
        ) : (
          <div className="space-y-2">
            {risks.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="truncate flex-1">{r.risk}</span>
                <div className="flex gap-1 ml-2">
                  <UI.Badge variant={r.probability === 'High' ? 'destructive' : 'secondary'} className="text-xs">
                    P:{r.probability[0]}
                  </UI.Badge>
                  <UI.Badge variant={r.impact === 'High' ? 'destructive' : 'secondary'} className="text-xs">
                    I:{r.impact[0]}
                  </UI.Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </UI.CardContent>
    </UI.Card>
  );
}
`,

    // Action Buttons
    ActionButtons: `
export default function ActionButtons() {
  const [phase, setPhase] = useState('Ideation');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const match = content.match(/Current Phase \\|\\s*([^|]+)\\s*\\|/);
      if (match) setPhase(match[1].trim());
    });
  }, []);

  const actions = {
    'Ideation': { label: 'Submit Scope', tool: 'submit_scope' },
    'Scoping': { label: 'Approve Scope', tool: 'approve_scope' },
    'Planning': { label: 'Lock Plan', tool: 'lock_plan' },
    'Execution': { label: 'Submit Review', tool: 'submit_review' },
    'Review': { label: 'Close Project', tool: 'close_project' },
    'Closure': { label: 'Project Closed', tool: null }
  };

  const currentAction = actions[phase] || { label: 'Unknown', tool: null };

  async function handleAction() {
    if (!currentAction.tool) return;
    setLoading(true);
    try {
      await surfaceApi.callAgent(\`Execute \${currentAction.tool} for this project\`);
      // Reload phase
      const content = await surfaceApi.readFile('PROJECT_MAP.md');
      const match = content.match(/Current Phase \\|\\s*([^|]+)\\s*\\|/);
      if (match) setPhase(match[1].trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <UI.Card>
      <UI.CardHeader>
        <UI.CardTitle className="text-sm font-medium">Quick Actions</UI.CardTitle>
      </UI.CardHeader>
      <UI.CardContent className="space-y-2">
        <UI.Button 
          onClick={handleAction} 
          disabled={!currentAction.tool || loading}
          className="w-full"
        >
          {loading ? <UI.Icons.Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {currentAction.label}
        </UI.Button>
        <UI.Button 
          variant="outline" 
          className="w-full"
          onClick={() => surfaceApi.callAgent('Show project status report')}
        >
          View Status Report
        </UI.Button>
      </UI.CardContent>
    </UI.Card>
  );
}
`
};

export class SurfaceGenerator {
    constructor(surfaceManager) {
        this.surfaceManager = surfaceManager;
    }

    // Create a project dashboard surface
    async createProjectDashboard(projectName = 'Project') {
        // Create the surface
        const surface = await this.surfaceManager.createSurface(
            `${projectName} Dashboard`,
            `Project management dashboard for ${projectName}`,
            'vertical'
        );

        const surfaceId = surface.id;

        // Add components in order
        const components = [
            { name: 'ProjectHeader', template: 'ProjectHeader' },
            { name: 'PhaseTimeline', template: 'PhaseTimeline' },
            { name: 'TaskProgress', template: 'TaskProgress' },
            { name: 'GoalsWidget', template: 'GoalsWidget' },
            { name: 'RisksWidget', template: 'RisksWidget' },
            { name: 'ActionButtons', template: 'ActionButtons' }
        ];

        for (let i = 0; i < components.length; i++) {
            const comp = components[i];
            const source = COMPONENT_TEMPLATES[comp.template];
            if (source) {
                await this.surfaceManager.updateComponent(
                    surfaceId,
                    comp.name,
                    source.trim(),
                    {},
                    i
                );
            }
        }

        return {
            success: true,
            surfaceId,
            message: `Created project dashboard with ${components.length} components`,
            components: components.map(c => c.name)
        };
    }

    // Create a task board surface
    async createTaskBoard(projectName = 'Project') {
        const surface = await this.surfaceManager.createSurface(
            `${projectName} Tasks`,
            `Task board for ${projectName}`,
            'vertical'
        );

        const taskBoardSource = `
export default function TaskBoard() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    const content = await surfaceApi.readFile('PROJECT_MAP.md');
    const match = content.match(/## 5\\. Task Breakdown([\\s\\S]*?)(?=## 6|$)/);
    if (!match) return;

    const lines = match[1].split('\\n').filter(l => l.trim().startsWith('|') && !l.includes('Task') && !l.includes('---'));
    const parsed = lines.map(l => {
      const cols = l.split('|').map(c => c.trim()).filter(c => c);
      return {
        id: cols[0],
        task: cols[1],
        deliverable: cols[2],
        assignee: cols[3],
        status: cols[4],
        priority: cols[5]
      };
    });
    setTasks(parsed);
  }

  const statusColumns = ['Todo', 'In Progress', 'Done', 'Blocked'];
  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.priority === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['all', 'High', 'Medium', 'Low'].map(f => (
          <UI.Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f}
          </UI.Button>
        ))}
        <UI.Button variant="ghost" size="sm" onClick={loadTasks}>
          <UI.Icons.RefreshCw className="w-4 h-4" />
        </UI.Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {statusColumns.map(status => (
          <div key={status} className="bg-zinc-900 rounded-lg p-3">
            <div className="font-medium text-sm mb-3 flex items-center justify-between">
              {status}
              <UI.Badge variant="secondary">
                {filteredTasks.filter(t => t.status === status).length}
              </UI.Badge>
            </div>
            <div className="space-y-2">
              {filteredTasks.filter(t => t.status === status).map(task => (
                <div key={task.id} className="bg-zinc-800 p-2 rounded text-sm">
                  <div className="font-medium">{task.task}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {task.assignee} • {task.deliverable}
                  </div>
                  <UI.Badge 
                    variant={task.priority === 'High' ? 'destructive' : 'secondary'} 
                    className="text-xs mt-1"
                  >
                    {task.priority}
                  </UI.Badge>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

        await this.surfaceManager.updateComponent(
            surface.id,
            'TaskBoard',
            taskBoardSource.trim(),
            {},
            0
        );

        return {
            success: true,
            surfaceId: surface.id,
            message: 'Created task board surface'
        };
    }

    // Create a timeline/Gantt view surface
    async createTimelineView(projectName = 'Project') {
        const surface = await this.surfaceManager.createSurface(
            `${projectName} Timeline`,
            `Timeline view for ${projectName}`,
            'vertical'
        );

        const timelineSource = `
export default function TimelineView() {
  const [deliverables, setDeliverables] = useState([]);
  const phases = ['Ideation', 'Scoping', 'Planning', 'Execution', 'Review', 'Closure'];

  useEffect(() => {
    surfaceApi.readFile('PROJECT_MAP.md').then(content => {
      const match = content.match(/## 4\\. Deliverables Registry([\\s\\S]*?)(?=## 5|$)/);
      if (!match) return;

      const lines = match[1].split('\\n').filter(l => l.trim().startsWith('|') && !l.includes('Deliverable') && !l.includes('---'));
      const parsed = lines.map(l => {
        const cols = l.split('|').map(c => c.trim()).filter(c => c);
        return {
          id: cols[0],
          name: cols[1],
          owner: cols[2],
          phase: cols[3],
          status: cols[4]
        };
      });
      setDeliverables(parsed);
    });
  }, []);

  const statusColors = {
    'Not Started': 'bg-zinc-700',
    'In Progress': 'bg-blue-600',
    'Completed': 'bg-green-600',
    'Blocked': 'bg-red-600'
  };

  return (
    <UI.Card>
      <UI.CardHeader>
        <UI.CardTitle>Deliverable Timeline</UI.CardTitle>
      </UI.CardHeader>
      <UI.CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-2 w-48">Deliverable</th>
                {phases.map(p => (
                  <th key={p} className="text-center p-2 w-24 text-xs">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deliverables.map(del => {
                const phaseIndex = phases.indexOf(del.phase);
                return (
                  <tr key={del.id} className="border-t border-zinc-800">
                    <td className="p-2">
                      <div className="font-medium">{del.name}</div>
                      <div className="text-xs text-zinc-500">{del.owner}</div>
                    </td>
                    {phases.map((p, idx) => (
                      <td key={p} className="p-2">
                        {idx === phaseIndex && (
                          <div className={\`h-6 rounded \${statusColors[del.status] || 'bg-zinc-700'} flex items-center justify-center text-xs\`}>
                            {del.status}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </UI.CardContent>
    </UI.Card>
  );
}
`;

        await this.surfaceManager.updateComponent(
            surface.id,
            'TimelineView',
            timelineSource.trim(),
            {},
            0
        );

        return {
            success: true,
            surfaceId: surface.id,
            message: 'Created timeline view surface'
        };
    }

    // Add a single component to an existing surface
    async addComponent(surfaceId, componentName) {
        const template = COMPONENT_TEMPLATES[componentName];
        if (!template) {
            return { success: false, message: `Unknown component: ${componentName}` };
        }

        await this.surfaceManager.updateComponent(
            surfaceId,
            componentName,
            template.trim(),
            {}
        );

        return {
            success: true,
            message: `Added component ${componentName} to surface`
        };
    }

    // List available component templates
    listComponentTemplates() {
        return Object.keys(COMPONENT_TEMPLATES).map(name => ({
            name,
            description: this.getComponentDescription(name)
        }));
    }

    // Get component description
    getComponentDescription(name) {
        const descriptions = {
            ProjectHeader: 'Displays project name, type, status, and current phase',
            PhaseTimeline: 'Visual timeline showing phase progression',
            TaskProgress: 'Task completion statistics and progress bar',
            GoalsWidget: 'List of project goals with status',
            RisksWidget: 'Risk registry with severity indicators',
            ActionButtons: 'Quick action buttons for phase transitions'
        };
        return descriptions[name] || 'Custom component';
    }

    // Create all standard surfaces for a project
    async createAllSurfaces(projectName) {
        const results = {
            dashboard: null,
            taskBoard: null,
            timeline: null
        };

        results.dashboard = await this.createProjectDashboard(projectName);
        results.taskBoard = await this.createTaskBoard(projectName);
        results.timeline = await this.createTimelineView(projectName);

        return {
            success: true,
            message: `Created 3 project surfaces for ${projectName}`,
            surfaces: results
        };
    }
}

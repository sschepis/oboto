export type Role = 'user' | 'ai';
export type MessageType = 'text' | 'image' | 'table' | 'log' | 'tool-call' | 'visualization' | 'html-sandbox' | 'survey' | 'agent-execution' | 'approval' | 'background-tasks' | 'agent-handoff' | 'code-diff' | 'telemetry' | 'search' | 'terminal' | 'secret-request' | 'test-results' | 'browser-preview';

export interface Step {
  label: string;
  status: 'done' | 'pending' | 'failed';
}

export interface Task {
  name: string;
  subtext?: string;
  progress: number;
  status: 'running' | 'completed';
  logs?: string[];
}

export interface SearchResult {
  source: string;
  title: string;
  snippet: string;
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'pending' | 'skipped';
  duration: number;
  failureMessage?: string;
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
  passed: number;
  failed: number;
  pending: number;
  duration: number;
  failureMessage?: string;
}

export interface TestResults {
  suites: TestSuite[];
  totalPassed: number;
  totalFailed: number;
  totalPending: number;
  totalDuration: number;
  testCommand: string;
  exitCode: number;
  rawOutput?: string;
}

export interface Message {
  id: string;
  role: Role;
  type: MessageType;
  content?: string;
  timestamp: string;
  
  // Specific to certain types
  toolName?: string;
  args?: unknown;
  result?: unknown;
  
  url?: string;
  caption?: string;
  
  title?: string;
  headers?: string[];
  rows?: string[][];
  
  code?: string;
  
  question?: string;
  options?: string[];
  
  steps?: Step[];
  status?: string; // For agent-execution

  // For ThinkingStream
  thoughts?: string;

  // For ApprovalBlock
  action?: string;
  description?: string;

  // For BackgroundSubstrate
  tasks?: Task[];

  // For AgentOrchestrator
  from?: string;
  to?: string;
  task?: string;

  // For CodeDiff
  filename?: string;
  oldCode?: string;
  newCode?: string;

  // For SearchSubstrate
  query?: string;
  results?: SearchResult[];

  // For InteractiveTerminal
  output?: string[];

  // For SecretVaultBlock
  label?: string;

  // For TestResultsPanel
  testResults?: TestResults;

  // For BrowserPreview
  browserPreview?: {
    url: string;
    title: string;
    screenshot: string; // base64
    logs: string[];
  };

  // For grouped tool calls attached to a text message
  toolCalls?: Array<{
      toolName: string;
      args: unknown;
      result?: unknown;
  }>;
}

export interface Command {
  id: string;
  label: string;
  desc?: string;
  icon?: React.ReactNode;
  shortcut?: string;
}

export interface GraphNode {
  x: number;
  y: number;
  label: string;
}

export interface GraphLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SystemStat {
  title: string;
  status: string;
  color?: string;
}

export interface OpenClawStatus {
    available: boolean;
    connected: boolean;
    mode: string | null;
    url: string | null;
    path?: string | null;
    authToken?: string | null;
}

export interface ConfirmationRequest {
    id: string;
    toolName: string;
    args: unknown;
    message: string;
    pathPrefix?: string;
}

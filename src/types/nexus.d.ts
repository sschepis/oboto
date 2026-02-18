export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface INexusService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ServiceStatus;
}

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  created: Date;
}

export interface IProjectManager {
  createProject(name: string, path: string): Promise<ProjectConfig>;
  loadProject(path: string): Promise<ProjectConfig>;
}

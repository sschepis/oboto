import { IProjectManager, ProjectConfig } from '../types/nexus';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';

export class ProjectManager implements IProjectManager {
  async createProject(name: string, path: string): Promise<ProjectConfig> {
    try {
      const projectPath = join(path, name);
      await mkdir(projectPath, { recursive: true });

      const config: ProjectConfig = {
        id: `proj-${Date.now()}`,
        name,
        path: projectPath,
        created: new Date(),
      };

      // Save initial configuration
      await writeFile(join(projectPath, 'project.json'), JSON.stringify(config, null, 2));
      
      // Create initial ui.json
      const initialUi = {
        project_id: config.id,
        layout: 'grid',
        components: []
      };
      await writeFile(join(projectPath, 'ui.json'), JSON.stringify(initialUi, null, 2));

      return config;
    } catch (error: any) {
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  async loadProject(path: string): Promise<ProjectConfig> {
    try {
      const configPath = join(path, 'project.json');
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content) as ProjectConfig;
    } catch (error: any) {
       throw new Error(`Failed to load project from ${path}: ${error.message}`);
    }
  }
}

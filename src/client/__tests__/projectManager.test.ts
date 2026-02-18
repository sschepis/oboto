import { ProjectManager } from '../projectManager';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs/promises
jest.mock('fs/promises');

describe('ProjectManager', () => {
  let projectManager: ProjectManager;
  const mockPath = '/tmp/projects';
  const mockName = 'TestProject';
  const mockProjectPath = path.join(mockPath, mockName);

  beforeEach(() => {
    projectManager = new ProjectManager();
    // Reset mocks
    (fs.mkdir as jest.Mock).mockClear();
    (fs.writeFile as jest.Mock).mockClear();
    (fs.readFile as jest.Mock).mockClear();
  });

  it('should create a project successfully', async () => {
    // Mock mkdir to resolve successfully
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    // Mock writeFile to resolve successfully
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

    const config = await projectManager.createProject(mockName, mockPath);

    expect(config.name).toBe(mockName);
    expect(config.path).toBe(mockProjectPath);
    expect(config.id).toMatch(/^proj-\d+/);
    expect(config.created).toBeInstanceOf(Date);

    // Verify file operations
    expect(fs.mkdir).toHaveBeenCalledWith(mockProjectPath, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledTimes(2); // project.json and ui.json
  });

  it('should throw an error if project creation fails', async () => {
    (fs.mkdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

    await expect(projectManager.createProject(mockName, mockPath)).rejects.toThrow('Failed to create project: Permission denied');
  });

  it('should load an existing project', async () => {
    const mockConfig = {
      id: 'proj-123',
      name: mockName,
      path: mockProjectPath,
      created: new Date().toISOString(),
    };

    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));

    const config = await projectManager.loadProject(mockProjectPath);

    expect(config).toEqual(mockConfig);
    expect(fs.readFile).toHaveBeenCalledWith(path.join(mockProjectPath, 'project.json'), 'utf-8');
  });

  it('should throw an error if loading project fails', async () => {
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));

    await expect(projectManager.loadProject(mockProjectPath)).rejects.toThrow(`Failed to load project from ${mockProjectPath}: File not found`);
  });
});

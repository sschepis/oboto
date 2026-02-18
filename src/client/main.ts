import { NexusService } from '../service/nexusService';
import { ProjectManager } from './projectManager';

async function main() {
  console.log('Starting Nexus Client...');

  const service = new NexusService();
  const projectManager = new ProjectManager();

  await service.start();

  console.log('Nexus Client started.');

  // Example usage:
  // await projectManager.createProject('MyProject', './projects');
}

main().catch(console.error);

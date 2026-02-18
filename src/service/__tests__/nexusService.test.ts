import { NexusService } from '../nexusService';

describe('NexusService', () => {
  let service: NexusService;

  beforeEach(() => {
    service = new NexusService();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('should start with a status of stopped', () => {
    expect(service.getStatus()).toBe('stopped');
  });

  it('should transition to running after start() is called', async () => {
    const startPromise = service.start();
    expect(service.getStatus()).toBe('starting');
    await startPromise;
    expect(service.getStatus()).toBe('running');
  });

  it('should not restart if already running', async () => {
    await service.start();
    const status = service.getStatus();
    await service.start();
    expect(service.getStatus()).toBe(status);
  });

  it('should transition to stopped after stop() is called', async () => {
    await service.start();
    await service.stop();
    expect(service.getStatus()).toBe('stopped');
  });
});

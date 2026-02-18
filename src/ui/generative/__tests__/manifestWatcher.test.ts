import { ManifestWatcher } from '../manifestWatcher';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';

jest.mock('chokidar');
jest.mock('fs/promises');

describe('ManifestWatcher', () => {
  let watcher: ManifestWatcher;
  let mockOnChange: jest.Mock;
  let mockFsWatcher: any;

  beforeEach(() => {
    mockOnChange = jest.fn();
    mockFsWatcher = {
      on: jest.fn(),
      close: jest.fn(),
    };
    (chokidar.watch as jest.Mock).mockReturnValue(mockFsWatcher);
    watcher = new ManifestWatcher(mockOnChange);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should start watching a file', async () => {
    const filePath = '/path/to/ui.json';
    await watcher.start(filePath);

    expect(chokidar.watch).toHaveBeenCalledWith(filePath, expect.any(Object));
    expect(mockFsWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mockFsWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
  });

  it('should stop watching a file', async () => {
    await watcher.start('/path/to/ui.json');
    await watcher.stop();

    expect(mockFsWatcher.close).toHaveBeenCalled();
  });

  it('should call onChange when file changes', async () => {
    const mockManifest = { project_id: '123', layout: 'grid', components: [] };
    const filePath = '/path/to/ui.json';
    
    // Setup file read mock
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockManifest));

    await watcher.start(filePath);

    // Simulate change event
    const changeCallback = mockFsWatcher.on.mock.calls.find((call: any[]) => call[0] === 'change')[1];
    changeCallback(filePath);

    // Wait for debounce and async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(mockOnChange).toHaveBeenCalledWith(mockManifest);
    expect(watcher.getCurrentManifest()).toEqual(mockManifest);
  });

  it('should handle file read errors gracefully', async () => {
    const filePath = '/path/to/ui.json';
    
    // Setup file read mock to fail
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('Read error'));

    // Mock console.error to prevent cluttering output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await watcher.start(filePath);

    // Simulate change event
    const changeCallback = mockFsWatcher.on.mock.calls.find((call: any[]) => call[0] === 'change')[1];
    changeCallback(filePath);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(mockOnChange).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Error reading manifest:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});

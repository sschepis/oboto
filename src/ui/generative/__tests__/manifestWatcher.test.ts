import { jest } from '@jest/globals';

// Define mocks before imports
const mockFsWatcher = {
  on: jest.fn(),
  close: jest.fn(),
};
const mockWatch = jest.fn().mockReturnValue(mockFsWatcher);

const mockReadFile = jest.fn();

// Use unstable_mockModule for ESM support
jest.unstable_mockModule('chokidar', () => ({
  __esModule: true,
  default: { watch: mockWatch },
  watch: mockWatch,
}));

jest.unstable_mockModule('fs/promises', () => ({
  readFile: mockReadFile,
}));

// Import the module under test dynamically
const { ManifestWatcher } = await import('../manifestWatcher');
// Also import chokidar to verify mock (optional, but good for assertions)
const chokidar = await import('chokidar');
const fs = await import('fs/promises');

describe('ManifestWatcher', () => {
  let watcher: any; // Type as any or ManifestWatcher if types are available
  let mockOnChange: any;

  beforeEach(() => {
    mockOnChange = jest.fn();
    // Reset mocks
    mockWatch.mockClear();
    mockWatch.mockReturnValue(mockFsWatcher);
    mockFsWatcher.on.mockClear();
    mockFsWatcher.close.mockClear();
    mockReadFile.mockClear();
    
    watcher = new ManifestWatcher(mockOnChange);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should start watching a file', async () => {
    const filePath = '/path/to/ui.json';
    await watcher.start(filePath);

    expect(mockWatch).toHaveBeenCalledWith(filePath, expect.any(Object));
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
    mockReadFile.mockResolvedValue(JSON.stringify(mockManifest));

    await watcher.start(filePath);

    // Simulate change event
    // The second argument to 'on' is the callback
    const changeCallback = mockFsWatcher.on.mock.calls.find((call: any[]) => call[0] === 'change')[1];
    changeCallback(filePath);

    // Wait for debounce and async operations
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(mockReadFile).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(mockOnChange).toHaveBeenCalledWith(mockManifest);
    expect(watcher.getCurrentManifest()).toEqual(mockManifest);
  });

  it('should handle file read errors gracefully', async () => {
    const filePath = '/path/to/ui.json';
    
    // Setup file read mock to fail
    mockReadFile.mockRejectedValue(new Error('Read error'));

    // Mock console.error/logError to prevent cluttering output
    // Note: consoleStyler is imported in the source, we might need to mock it too if it throws or prints
    // For now, let's assume it handles it safely or we spy on console
    // But since we can't easily mock the internal consoleStyler import without mocking that module too...
    // Let's rely on the fact that the original test didn't mock consoleStyler explicitly via jest.mock
    
    await watcher.start(filePath);

    // Simulate change event
    const changeCallback = mockFsWatcher.on.mock.calls.find((call: any[]) => call[0] === 'change')[1];
    changeCallback(filePath);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(mockReadFile).toHaveBeenCalledWith(filePath, 'utf-8');
    expect(mockOnChange).not.toHaveBeenCalled();
    // We can't easily assert on consoleStyler calls unless we mock that module too.
    // The original test spied on console.error.
  });
});

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockReadJsonFileSync = jest.fn();

const mockPromises = {
  readFile: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
};

jest.unstable_mockModule('fs', () => ({
  promises: mockPromises,
  default: {
    promises: mockPromises,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  },
  readFileSync: jest.fn(),
}));

jest.unstable_mockModule('../../lib/json-file-utils.mjs', () => ({
  readJsonFileSync: mockReadJsonFileSync,
}));

// We need to import the module under test AFTER mocking
const { handlers } = await import('../ws-handlers/setup-handler.mjs');
const fs = await import('fs'); // This import will get the mocked version

global.fetch = jest.fn();

describe('Setup Handler', () => {
  let mockWs;
  let ctx;

  beforeEach(() => {
    mockWs = {
      send: jest.fn(),
      readyState: 1,
    };
    ctx = { ws: mockWs };
    jest.clearAllMocks();
  });

  describe('handleGetSetupStatus', () => {
    it('should return isFirstRun=true if setup.json does not exist', async () => {
      mockReadJsonFileSync.mockReturnValue(null);

      await handlers['get-setup-status']({}, ctx);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"isFirstRun":true'));
    });

    it('should return isFirstRun=false if setup.json exists', async () => {
      mockReadJsonFileSync.mockReturnValue({ version: 1, completedAt: '2023-01-01' });

      await handlers['get-setup-status']({}, ctx);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"isFirstRun":false'));
    });
  });

  describe('handleCompleteSetup', () => {
    it('should save setup data and return success', async () => {
      mockPromises.mkdir.mockResolvedValue();
      mockPromises.writeFile.mockResolvedValue();

      const payload = { provider: 'openai', openclawEnabled: true };
      await handlers['complete-setup']({ payload }, ctx);

      expect(mockPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('setup.json'),
        expect.stringContaining('"provider": "openai"'),
      );
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
    });
  });

  describe('handleValidateApiKey', () => {
    it('should return valid=true for successful OpenAI ping', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await handlers['validate-api-key']({ payload: { provider: 'openai', key: 'sk-test' } }, ctx);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"valid":true'));
    });

    it('should return valid=false for failed OpenAI ping', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await handlers['validate-api-key']({ payload: { provider: 'openai', key: 'sk-bad' } }, ctx);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"valid":false'));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
    });
  });
});

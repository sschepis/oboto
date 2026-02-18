import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { OpenClawClient } from './client.mjs';

/**
 * Manages the OpenClaw integration lifecycle.
 * Handles configuration, process management (integrated mode), and client connection.
 */
export class OpenClawManager {
  constructor(secretsManager = null) {
    this.secretsManager = secretsManager;
    this.client = null;
    this.process = null;
    this.config = {
      mode: process.env.OPENCLAW_MODE || 'external',
      url: process.env.OPENCLAW_URL || 'ws://127.0.0.1:18789',
      authToken: process.env.OPENCLAW_AUTH_TOKEN,
      path: process.env.OPENCLAW_PATH
    };
  }

  /**
   * Starts the OpenClaw integration.
   * Spawns process if integrated, then connects client.
   * @param {string} [workspaceDir] - Optional workspace directory to load overrides from
   */
  async start(workspaceDir = null) {
    if (workspaceDir) {
        await this.loadConfig(workspaceDir);
    }

    console.log(`[OpenClawManager] Starting in ${this.config.mode} mode...`);

    if (this.config.mode === 'integrated') {
      await this.spawnProcess();
    }

    this.client = new OpenClawClient(this.config.url, this.config.authToken);

    this.client.on('connected', () => {
      console.log('[OpenClawManager] Client connected successfully');
    });

    this.client.on('disconnected', () => {
      console.log('[OpenClawManager] Client disconnected');
    });

    this.client.on('error', (err) => {
      console.error('[OpenClawManager] Client error:', err);
    });

    // Attempt to connect with retries
    await this.connectWithRetry();
  }

  /**
   * Load configuration with workspace overrides
   * @param {string} workspaceDir 
   */
  async loadConfig(workspaceDir) {
      // 1. Reset to Global (Env) which ensures we start clean from global secrets/env
      this.config = {
          mode: process.env.OPENCLAW_MODE || 'external',
          url: process.env.OPENCLAW_URL || 'ws://127.0.0.1:18789',
          authToken: process.env.OPENCLAW_AUTH_TOKEN,
          path: process.env.OPENCLAW_PATH
      };

      // 2. Check Workspace Override
      if (workspaceDir) {
          const localConfigPath = path.join(workspaceDir, '.ai-man', 'openclaw.json');
          if (fs.existsSync(localConfigPath)) {
              try {
                  const content = await fs.promises.readFile(localConfigPath, 'utf8');
                  const localConfig = JSON.parse(content);
                  console.log(`[OpenClawManager] Loaded workspace override from ${localConfigPath}`);
                  this.config = { ...this.config, ...localConfig };
              } catch (err) {
                  console.warn(`[OpenClawManager] Failed to load workspace config: ${err.message}`);
              }
          }
      }
  }

  /**
   * Connects to OpenClaw with retry logic.
   * @param {number} retries 
   * @param {number} delay 
   */
  async connectWithRetry(retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.client.connect();
        return;
      } catch (err) {
        console.warn(`[OpenClawManager] Connection attempt ${i + 1}/${retries} failed: ${err.message}`);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    console.error('[OpenClawManager] Failed to connect after multiple attempts');
  }

  /**
   * Installs OpenClaw from the specified fork.
   */
  async install() {
      if (!this.config.path) {
          throw new Error('OPENCLAW_PATH is required for installation');
      }

      console.log(`[OpenClawManager] Installing OpenClaw to ${this.config.path}...`);

      // Ensure directory exists or create it
      // Actually git clone will fail if directory exists and is not empty.
      // So we should check if it exists.
      
      if (fs.existsSync(this.config.path)) {
           // Check if it's empty or already a git repo
           // For now, let's assume if it exists, we try to update or just run npm install
           console.log(`[OpenClawManager] Path ${this.config.path} exists. Attempting update/install...`);
      } else {
           // Clone
           console.log(`[OpenClawManager] Cloning https://github.com/sschepis/openclaw.git...`);
           await this.runCommand('git', ['clone', 'https://github.com/sschepis/openclaw.git', this.config.path]);
      }

      // npm install
      console.log(`[OpenClawManager] Running npm install in ${this.config.path}...`);
      await this.runCommand('npm', ['install'], { cwd: this.config.path });
      
      console.log('[OpenClawManager] Installation complete.');
  }

  runCommand(command, args, options = {}) {
      return new Promise((resolve, reject) => {
          const proc = spawn(command, args, { stdio: 'inherit', ...options });
          proc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`${command} exited with code ${code}`));
          });
          proc.on('error', reject);
      });
  }

  /**
   * Spawns the OpenClaw Gateway process.
   */
  async spawnProcess() {
    if (!this.config.path) {
      throw new Error('OPENCLAW_PATH is required for integrated mode');
    }

    // Check if openclaw.mjs exists, if not, maybe we need to install?
    // But spawnProcess assumes it's there.
    
    // Assuming openclaw.mjs is in the root of OPENCLAW_PATH
    // Command: node openclaw.mjs gateway run
    console.log(`[OpenClawManager] Spawning OpenClaw from ${this.config.path}`);

    try {
      this.process = spawn('node', ['openclaw.mjs', 'gateway', 'run'], {
        cwd: this.config.path,
        stdio: 'inherit', // Pipe output to parent for now
        env: { ...process.env }
      });

      this.process.on('error', (err) => {
        console.error('[OpenClawManager] Process spawn error:', err);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[OpenClawManager] Process exited with code ${code} signal ${signal}`);
        this.process = null;
      });

      // Give the process a moment to initialize before we try to connect
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.error('[OpenClawManager] Failed to spawn process:', err);
      throw err;
    }
  }

  /**
   * Stops the OpenClaw integration.
   */
  async stop() {
    console.log('[OpenClawManager] Stopping...');
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    if (this.process) {
      console.log('[OpenClawManager] Killing process...');
      this.process.kill(); // SIGTERM
      this.process = null;
    }
  }

  /**
   * Updates configuration dynamically and optionally persists it.
   * @param {object} newConfig - Partial config object to update
   * @param {string} scope - 'session', 'global', or 'workspace'
   * @param {string} workspaceDir - Required if scope is 'workspace'
   */
  async setConfig(newConfig, scope = 'session', workspaceDir = null) {
    this.config = { ...this.config, ...newConfig };
    console.log('[OpenClawManager] Configuration updated:', this.config);

    if (scope === 'global' && this.secretsManager) {
        if (newConfig.mode) await this.secretsManager.set('OPENCLAW_MODE', newConfig.mode, 'Integrations', 'OpenClaw integration mode');
        if (newConfig.url) await this.secretsManager.set('OPENCLAW_URL', newConfig.url, 'Endpoints', 'OpenClaw WebSocket URL');
        if (newConfig.authToken) await this.secretsManager.set('OPENCLAW_AUTH_TOKEN', newConfig.authToken, 'Integrations', 'OpenClaw gateway authentication token');
        if (newConfig.path) await this.secretsManager.set('OPENCLAW_PATH', newConfig.path, 'Endpoints', 'Path to OpenClaw binary');
        console.log('[OpenClawManager] Global configuration saved to vault');
    } else if (scope === 'workspace' && workspaceDir) {
        const configDir = path.join(workspaceDir, '.ai-man');
        if (!fs.existsSync(configDir)) {
            await fs.promises.mkdir(configDir, { recursive: true });
        }
        const localConfigPath = path.join(configDir, 'openclaw.json');
        
        const toSave = {
            mode: this.config.mode,
            url: this.config.url,
            authToken: this.config.authToken,
            path: this.config.path
        };
        await fs.promises.writeFile(localConfigPath, JSON.stringify(toSave, null, 2));
         console.log(`[OpenClawManager] Workspace configuration saved to ${localConfigPath}`);
    }
  }

  /**
   * Restarts the manager with current configuration.
   * @param {string} [workspaceDir] - Optional workspace directory for context
   */
  async restart(workspaceDir = null) {
    console.log('[OpenClawManager] Restarting...');
    await this.stop();
    await this.start(workspaceDir);
  }
}


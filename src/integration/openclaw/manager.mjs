import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
      try {
        await this.spawnProcess();
      } catch (err) {
        console.error('[OpenClawManager] Failed to spawn process, continuing without it:', err.message);
      }
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
    this.connectWithRetry();
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
        // console.warn(`[OpenClawManager] Connection attempt ${i + 1}/${retries} failed: ${err.message}`);
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    console.error('[OpenClawManager] Failed to connect after multiple attempts');
  }

  /**
   * Enhanced install method with progress reporting.
   * @param {function} onProgress - Callback: (step, status, detail) => void
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async install(onProgress = () => {}) {
      if (!this.config.path) {
          throw new Error('OPENCLAW_PATH is required for installation');
      }

      try {
          // Step 1: Prerequisites
          onProgress('prereqs', 'running', 'Checking prerequisites...');
          const prereqs = await this.checkPrerequisites();
          if (!prereqs.node.sufficient) {
              throw new Error(`Node.js >= 22 required (found: ${prereqs.node.version || 'not installed'})`);
          }
          if (!prereqs.pnpm.installed) {
              onProgress('prereqs', 'running', 'Installing pnpm...');
              await this.runCommand('npm', ['install', '-g', 'pnpm@latest']);
          }
          if (!prereqs.git.installed) {
              throw new Error('git is required but not installed');
          }
          onProgress('prereqs', 'done', 'Prerequisites verified');

          // Step 2: Clone or update
          if (fs.existsSync(this.config.path)) {
              const isGitRepo = fs.existsSync(
                  path.join(this.config.path, '.git')
              );
              if (isGitRepo) {
                  onProgress('clone', 'running', 'Updating existing repository...');
                  await this.runCommand('git', ['pull', '--rebase'], {
                      cwd: this.config.path
                  });
              } else {
                  // Path exists but isn't a git repo
                  const hasOpenClaw = fs.existsSync(
                      path.join(this.config.path, 'openclaw.mjs')
                  );
                  if (!hasOpenClaw) {
                      throw new Error(
                          `Path ${this.config.path} exists but is not an OpenClaw repository`
                      );
                  }
                  // It's an npm-installed copy — skip clone
                  onProgress('clone', 'skipped', 'Using existing installation');
              }
          } else {
              onProgress('clone', 'running', 'Cloning repository...');
              await this.runCommand('git', [
                  'clone',
                  '--depth', '1',  // Shallow clone for speed
                  'https://github.com/sschepis/openclaw.git',
                  this.config.path
              ]);
          }
          onProgress('clone', 'done', 'Repository ready');

          // Step 3: Install dependencies
          onProgress('install', 'running', 'Installing dependencies (this may take a few minutes)...');
          await this.runCommand('pnpm', ['install', '--frozen-lockfile'], {
              cwd: this.config.path,
              env: {
                  ...process.env,
                  // Skip postinstall completion setup during wizard install
                  OPENCLAW_SKIP_COMPLETION_SETUP: '1'
              }
          });
          onProgress('install', 'done', 'Dependencies installed');

          // Step 4: Build
          onProgress('build', 'running', 'Building OpenClaw...');
          await this.runCommand('pnpm', ['build'], {
              cwd: this.config.path
          });
          onProgress('build', 'done', 'Build complete');

          // Step 5: Build UI
          onProgress('ui-build', 'running', 'Building UI...');
          await this.runCommand('pnpm', ['ui:build'], {
              cwd: this.config.path
          });
          onProgress('ui-build', 'done', 'UI built');

          // Step 6: Generate auth token
          onProgress('auth-token', 'running', 'Generating gateway auth token...');
          const crypto = await import('crypto');
          const authToken = crypto.randomBytes(32).toString('hex');
          this.config.authToken = authToken;
          onProgress('auth-token', 'done', 'Auth token generated');

          // Step 7: Save configuration
          onProgress('config', 'running', 'Saving configuration...');
          this.config.mode = 'integrated';
          this.config.url = 'ws://127.0.0.1:18789';
          
          if (this.secretsManager) {
              await this.secretsManager.set(
                  'OPENCLAW_MODE', 'integrated',
                  'Integrations', 'OpenClaw integration mode'
              );
              await this.secretsManager.set(
                  'OPENCLAW_URL', this.config.url,
                  'Endpoints', 'OpenClaw WebSocket URL'
              );
              await this.secretsManager.set(
                  'OPENCLAW_AUTH_TOKEN', authToken,
                  'Integrations', 'OpenClaw gateway authentication token'
              );
              await this.secretsManager.set(
                  'OPENCLAW_PATH', this.config.path,
                  'Endpoints', 'Path to OpenClaw installation'
              );
          }
          
          // Auto-configure the gateway itself
          const gatewayConfig = {
              gateway: {
                  bind: 'loopback',
                  port: 18789
              }
          };
          const configDir = path.join(os.homedir(), '.openclaw');
          if (!fs.existsSync(configDir)) {
             await fs.promises.mkdir(configDir, { recursive: true });
          }
          await fs.promises.writeFile(
             path.join(configDir, 'openclaw.json'),
             JSON.stringify(gatewayConfig, null, 2)
          );
          
          onProgress('config', 'done', 'Configuration saved to vault');

          // Step 8: Start gateway
          onProgress('start', 'running', 'Starting OpenClaw gateway...');
          // Ensure we stop any existing process first
          await this.stop();
          await this.spawnProcess();
          onProgress('start', 'done', 'Gateway process started');

          // Step 9: Health check
          onProgress('health-check', 'running', 'Verifying gateway is healthy...');
          const healthy = await this.healthCheck(15, 2000); // More generous timeout for first start
          if (!healthy) {
              throw new Error('Gateway started but health check failed (timeout)');
          }
          onProgress('health-check', 'done', 'Gateway is running and healthy');

          return { success: true };
      } catch (err) {
          console.error('[OpenClawManager] Install failed:', err);
          return { success: false, error: err.message };
      }
  }
  
  async checkPrerequisites() {
      const results = {
          node: { installed: false, version: null, sufficient: false },
          git: { installed: false, version: null },
          pnpm: { installed: false, version: null, sufficient: false },
          docker: { installed: false, version: null },
      };
      
      const execAsync = (cmd) => new Promise((resolve, reject) => {
         exec(cmd, (error, stdout, stderr) => {
             if (error) reject(error);
             else resolve({ stdout, stderr });
         });
      });

      // Check Node.js version
      try {
          const nodeVersion = process.version; // e.g., 'v22.12.0'
          const major = parseInt(nodeVersion.slice(1).split('.')[0]);
          results.node = {
              installed: true,
              version: nodeVersion,
              sufficient: major >= 22
          };
      } catch {}

      // Check git
      try {
          const { stdout } = await execAsync('git --version');
          const match = stdout.match(/git version (\S+)/);
          results.git = {
              installed: true,
              version: match ? match[1] : stdout.trim()
          };
      } catch {}

      // Check pnpm
      try {
          const { stdout } = await execAsync('pnpm --version');
          const version = stdout.trim();
          const major = parseInt(version.split('.')[0]);
          results.pnpm = {
              installed: true,
              version,
              sufficient: major >= 9 
          };
      } catch {}

      // Check Docker
      try {
          const { stdout } = await execAsync('docker --version');
          results.docker = {
              installed: true,
              version: stdout.trim()
          };
      } catch {}

      return results;
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
  
  runCommandWithOutput(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('close', (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(
                `${command} exited with code ${code}\n${stderr || stdout}`
            ));
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

    // Prefer dist/index.js (production) over openclaw.mjs (development)
    const entryPoint = fs.existsSync(
        path.join(this.config.path, 'dist', 'index.js')
    )
        ? ['dist/index.js', 'gateway']
        : ['openclaw.mjs', 'gateway', 'run'];

    console.log(`[OpenClawManager] Spawning OpenClaw from ${this.config.path}`);

    const gatewayEnv = {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: this.config.authToken,
        // Forward the AI API keys from RoboDev's environment
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        // Ensure config dirs are correct
        OPENCLAW_CONFIG_DIR: path.join(os.homedir(), '.openclaw'),
        OPENCLAW_WORKSPACE_DIR: path.join(os.homedir(), '.openclaw', 'workspace'),
    };

    try {
      this.process = spawn('node', [
        ...entryPoint,
        '--bind', 'loopback',
        '--port', '18789',
        // '--verbose'
      ], {
        cwd: this.config.path,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gatewayEnv,
        detached: false, // Tied to parent process lifecycle
      });

      this.process.stdout?.on('data', (data) => {
         // console.log(`[OpenClaw] ${data.toString().trim()}`);
      });
      this.process.stderr?.on('data', (data) => {
         // console.error(`[OpenClaw:err] ${data.toString().trim()}`);
      });

      this.process.on('error', (err) => {
        console.error('[OpenClawManager] Process spawn error:', err);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[OpenClawManager] Process exited with code ${code} signal ${signal}`);
        this.process = null;
      });

      // Give the process a moment to initialize before we try to connect
      await this.waitForReady(10, 1500);
    } catch (err) {
      console.error('[OpenClawManager] Failed to spawn process:', err);
      throw err;
    }
  }
  
  async waitForReady(retries = 10, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch('http://127.0.0.1:18789/health', {
                signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
                console.log('[OpenClawManager] Gateway is ready');
                return;
            }
        } catch {}
        
        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delay));
        }
    }
    console.warn('[OpenClawManager] Gateway may not be fully ready');
  }
  
  async healthCheck(retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(
                `http://127.0.0.1:18789/health`,
                { signal: AbortSignal.timeout(3000) }
            );
            if (response.ok) return true;
        } catch {}
        
        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delay));
        }
    }
    return false;
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
      
      // Force kill if it doesn't exit
      setTimeout(() => {
          if (this.process) {
              try { this.process.kill('SIGKILL'); } catch {}
          }
      }, 5000);
      
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

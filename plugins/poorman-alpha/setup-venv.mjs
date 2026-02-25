#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_DIR = __dirname;
const VENV_DIR = path.join(PLUGIN_DIR, '.venv');
const IS_WIN = process.platform === 'win32';
const PYTHON_BIN = IS_WIN
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python3');
const PIP_BIN = IS_WIN
  ? path.join(VENV_DIR, 'Scripts', 'pip.exe')
  : path.join(VENV_DIR, 'bin', 'pip3');

const REQUIRED_PACKAGES = ['sympy'];
const OPTIONAL_PACKAGES = ['matplotlib'];

function checkPython() {
  try {
    const cmd = IS_WIN ? 'python --version' : 'python3 --version';
    execSync(cmd, { stdio: 'ignore' });
    return IS_WIN ? 'python' : 'python3';
  } catch (_e) {
    try {
      execSync('python --version', { stdio: 'ignore' });
      return 'python';
    } catch (_e2) {
      return null;
    }
  }
}

function createVenv() {
  console.log(`[setup-venv] Setting up virtual environment in ${VENV_DIR}`);
  if (fs.existsSync(VENV_DIR)) {
    console.log(`[setup-venv] Virtual environment already exists.`);
    return true;
  }

  const sysPython = checkPython();
  if (!sysPython) {
    console.error(`[setup-venv] ERROR: Python 3 is not installed or not in PATH.`);
    console.error(`[setup-venv] Please install Python 3 to use the poorman-alpha plugin's SymPy features.`);
    return false;
  }

  try {
    console.log(`[setup-venv] Creating venv using '${sysPython} -m venv .venv'...`);
    spawnSync(sysPython, ['-m', 'venv', '.venv'], { cwd: PLUGIN_DIR, stdio: 'inherit' });
    if (!fs.existsSync(VENV_DIR)) {
      throw new Error('venv directory not created');
    }
    console.log(`[setup-venv] Virtual environment created successfully.`);
    return true;
  } catch (err) {
    console.error(`[setup-venv] ERROR: Failed to create virtual environment: ${err.message}`);
    return false;
  }
}

function installPackages() {
  console.log(`[setup-venv] Installing required packages: ${REQUIRED_PACKAGES.join(', ')}...`);
  try {
    spawnSync(PIP_BIN, ['install', '--upgrade', 'pip'], { cwd: PLUGIN_DIR, stdio: 'ignore' });
    const result = spawnSync(PIP_BIN, ['install', ...REQUIRED_PACKAGES], { cwd: PLUGIN_DIR, stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn(`[setup-venv] WARNING: Failed to install some required packages.`);
    } else {
      console.log(`[setup-venv] Required packages installed successfully.`);
    }

    console.log(`[setup-venv] Installing optional packages: ${OPTIONAL_PACKAGES.join(', ')}...`);
    spawnSync(PIP_BIN, ['install', ...OPTIONAL_PACKAGES], { cwd: PLUGIN_DIR, stdio: 'inherit' });

    return true;
  } catch (err) {
    console.error(`[setup-venv] ERROR: Package installation failed: ${err.message}`);
    return false;
  }
}

function verifySetup() {
  console.log(`[setup-venv] Verifying SymPy installation...`);
  try {
    const testCode = 'import sympy; print(sympy.__version__)';
    const result = spawnSync(PYTHON_BIN, ['-c', testCode], { encoding: 'utf-8' });
    if (result.status === 0 && result.stdout) {
      console.log(`[setup-venv] OK: SymPy version ${result.stdout.trim()} is installed and working.`);
      return true;
    }
    console.error(`[setup-venv] FAIL: Python executed but failed to load sympy.`);
    return false;
  } catch (err) {
    console.error(`[setup-venv] FAIL: Could not execute Python from venv: ${err.message}`);
    return false;
  }
}

function cleanVenv() {
  if (fs.existsSync(VENV_DIR)) {
    console.log(`[setup-venv] Removing virtual environment at ${VENV_DIR}...`);
    try {
      fs.rmSync(VENV_DIR, { recursive: true, force: true });
      console.log(`[setup-venv] Removed successfully.`);
    } catch (err) {
      console.error(`[setup-venv] ERROR: Failed to remove directory: ${err.message}`);
    }
  } else {
    console.log(`[setup-venv] No virtual environment found.`);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clean')) {
    cleanVenv();
    return;
  }

  if (args.includes('--check')) {
    if (!fs.existsSync(PYTHON_BIN)) {
      console.log(`[setup-venv] Venv not found. Run without --check to create it.`);
      process.exit(1);
    }
    if (!verifySetup()) {
      process.exit(1);
    }
    return;
  }

  console.log(`--- poorman-alpha: Setting up Python Environment ---`);
  if (createVenv()) {
    installPackages();
    verifySetup();
  }
  console.log(`--- poorman-alpha: Setup Complete ---`);
}

main();

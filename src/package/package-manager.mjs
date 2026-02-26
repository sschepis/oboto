// Package management utilities
// Handles npm package installation with Node.js compatibility checks

import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { consoleStyler } from '../ui/console-styler.mjs';

const execPromise = util.promisify(exec);

export class PackageManager {
    constructor() {
        // Node.js v18 compatibility - packages with known issues
        this.problematicPackages = [
            'axios', 'undici', 'node-fetch', 'cheerio', 'jsdom',
            'puppeteer', 'playwright', 'got', 'superagent', 'request'
        ];
        
        this.nodeMajorVersion = parseInt(process.version.slice(1).split('.')[0]);
    }

    // Install a single npm package with compatibility checks
    async installPackage(packageName) {
        // Node.js compatibility check - proactively avoid packages with known issues
        if (this.nodeMajorVersion < 20 && this.problematicPackages.includes(packageName)) {
            consoleStyler.log('system', `Skipping ${packageName} - Node.js v${this.nodeMajorVersion} compatibility issue`);
            consoleStyler.log('system', 'Will use built-in alternatives (fetch for HTTP, regex for HTML parsing)');
            
            // Throw a specific error that can be caught and handled
            throw new Error(`COMPATIBILITY_SKIP: ${packageName} incompatible with Node.js v${this.nodeMajorVersion}`);
        }
        
        // Check if package might have undici dependencies in Node.js v18
        if (this.nodeMajorVersion < 20 && packageName.includes('fetch')) {
            consoleStyler.log('warning', `Warning: ${packageName} may have Node.js v${this.nodeMajorVersion} compatibility issues`);
            throw new Error(`COMPATIBILITY_SKIP: ${packageName} may be incompatible with Node.js v${this.nodeMajorVersion}`);
        }
        
        try {
            // Install in the script's directory
            const __filename = fileURLToPath(import.meta.url);
            const scriptDir = path.dirname(path.dirname(path.dirname(__filename))); // Go up two levels from src/package
            const { stdout, stderr } = await execPromise(`cd "${scriptDir}" && npm install ${packageName}`);
            
            if (stderr) {
                // Check stderr for undici/File errors
                if (stderr.includes('File is not defined') || stderr.includes('undici')) {
                    consoleStyler.log('system', `Node.js compatibility issue - skipping ${packageName}`);
                    return;
                }
            }
        } catch (error) {
            // Don't log error for compatibility skips
            if (!error.message.startsWith('COMPATIBILITY_SKIP:')) {
                consoleStyler.log('error', `Failed to install package '${packageName}': ${error.message}`);
                
                // Enhanced Node.js compatibility detection
                if (error.message.includes('File is not defined') ||
                    error.message.includes('undici') ||
                    error.message.includes('webidl') ||
                    error.stdout?.includes('File is not defined') ||
                    error.stderr?.includes('File is not defined')) {
                    consoleStyler.log('warning', `Node.js v${this.nodeMajorVersion} compatibility issue detected with ${packageName}`);
                    consoleStyler.log('warning', `Skipping ${packageName} - will use built-in alternatives (fetch, fs, etc.)`);
                    throw new Error(`COMPATIBILITY_SKIP: ${packageName} incompatible with Node.js v${this.nodeMajorVersion}`);
                }
            }
            
            throw error;
        }
    }

    // Install multiple packages with error handling
    async installPackages(packages) {
        const skippedPackages = [];
        const installedPackages = [];
        const failedPackages = [];

        // Helper function to handle single package installation
        const processPackage = async (pkg) => {
            try {
                // First check if package is already available
                await import(pkg);
                installedPackages.push(pkg);
            } catch (e) {
                if (e.code === 'ERR_MODULE_NOT_FOUND') {
                    try {
                        await this.installPackage(pkg);
                        // Verify the package is accessible after installation
                        try {
                            await import(pkg);
                            installedPackages.push(pkg);
                        } catch (e2) {
                            try {
                                const __filename = fileURLToPath(import.meta.url);
                                const scriptDir = path.dirname(path.dirname(__filename));
                                const modulePath = `file://${path.join(scriptDir, 'node_modules', pkg)}`;
                                await import(modulePath);
                                installedPackages.push(pkg);
                            } catch (e3) {
                                // For CommonJS modules, just ensure they're installed
                                installedPackages.push(pkg);
                            }
                        }
                    } catch (installError) {
                        if (installError.message.startsWith('COMPATIBILITY_SKIP:')) {
                            skippedPackages.push(pkg);
                            consoleStyler.log('system', `Skipped ${pkg} - will need to use built-in alternatives`);
                        } else {
                            failedPackages.push({ package: pkg, error: installError.message });
                        }
                    }
                } else {
                    failedPackages.push({ package: pkg, error: e.message });
                }
            }
        };

        // Process packages in parallel batches of 3 to avoid overwhelming system
        const BATCH_SIZE = 3;
        for (let i = 0; i < packages.length; i += BATCH_SIZE) {
            const batch = packages.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(pkg => processPackage(pkg)));
        }

        return {
            installed: installedPackages,
            skipped: skippedPackages,
            failed: failedPackages
        };
    }

    // Attempt to import a package with multiple strategies
    async importPackage(packageName) {
        try {
            // Try direct import first
            return await import(packageName);
        } catch (e) {
            if (e.code === 'ERR_MODULE_NOT_FOUND') {
                try {
                    // Try from script directory with file:// protocol
                    const __filename = fileURLToPath(import.meta.url);
                    const scriptDir = path.dirname(path.dirname(path.dirname(__filename)));
                    const modulePath = `file://${path.join(scriptDir, 'node_modules', packageName)}`;
                    return await import(modulePath);
                } catch (e2) {
                    try {
                        // Try with require for CommonJS modules
                        const { createRequire } = await import('module');
                        const require = createRequire(import.meta.url);
                        return { default: require(packageName) };
                    } catch (e3) {
                        throw e; // Re-throw original error
                    }
                }
            } else {
                throw e; // Re-throw other import errors
            }
        }
    }

    // Check if a package is problematic for the current Node.js version
    isProblematicPackage(packageName) {
        if (this.nodeMajorVersion < 20 && this.problematicPackages.includes(packageName)) {
            return true;
        }
        
        if (this.nodeMajorVersion < 20 && packageName.includes('fetch')) {
            return true;
        }
        
        return false;
    }

    // Get alternative suggestions for problematic packages
    getAlternatives(packageName) {
        const alternatives = {
            'axios': 'Use built-in fetch() for HTTP requests',
            'node-fetch': 'Use built-in fetch() for HTTP requests',
            'cheerio': 'Use regex patterns or built-in string methods for HTML parsing',
            'jsdom': 'Use regex patterns for simple HTML parsing',
            'puppeteer': 'Consider using simpler HTTP requests with fetch()',
            'playwright': 'Consider using simpler HTTP requests with fetch()',
            'got': 'Use built-in fetch() for HTTP requests',
            'superagent': 'Use built-in fetch() for HTTP requests',
            'request': 'Use built-in fetch() for HTTP requests (request is deprecated)'
        };

        return alternatives[packageName] || 'Consider using built-in Node.js modules or simpler alternatives';
    }

    // Log package installation results
    logInstallationResults(results) {
        if (results.installed.length > 0) {
            consoleStyler.log('packages', `✓ Installed/Available: ${results.installed.join(', ')}`);
        }
        
        if (results.skipped.length > 0) {
            consoleStyler.log('packages', `⚠ Skipped (compatibility): ${results.skipped.join(', ')}`);
            consoleStyler.log('packages', 'Use built-in alternatives instead');
        }
        
        if (results.failed.length > 0) {
            consoleStyler.log('packages', '✗ Failed installations:', { box: true });
            results.failed.forEach(({ package: pkg, error }) => {
                consoleStyler.log('packages', `  - ${pkg}: ${error}`, { indent: true });
            });
        }
    }

    // Set up require function for CommonJS modules
    async setupCommonJSRequire() {
        const { createRequire } = await import('module');
        const __filename = fileURLToPath(import.meta.url);
        const scriptDir = path.dirname(path.dirname(path.dirname(__filename)));
        const require = createRequire(path.join(scriptDir, 'package.json'));
        
        // Make require available globally
        global.require = require;
        
        return require;
    }
}
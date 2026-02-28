#!/usr/bin/env node
/**
 * oboto-server — Start the Oboto web server with UI.
 *
 * This binary is installed to PATH via npm's `bin` field, allowing users to
 * run `oboto-server` from the command line after `npm install -g @sschepis/oboto`.
 *
 * It injects `--server` into process.argv before delegating to the main
 * entry point, which detects the flag and boots the Express + WebSocket server.
 *
 * Usage:
 *   oboto-server                     # Start server on default port 3000
 *   oboto-server --cwd /path/to/dir  # Start server with a specific workspace
 */

// Inject --server flag so main() enters server mode
if (!process.argv.includes('--server')) {
    process.argv.splice(2, 0, '--server');
}

// Resolve relative to this file's location (bin/ is sibling to src/)
import { main } from '../src/main.mjs';

main().catch(err => {
    console.error('Fatal error starting Oboto server:', err);
    process.exit(1);
});

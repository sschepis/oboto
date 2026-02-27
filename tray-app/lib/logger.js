/**
 * Logger for the Oboto tray app.
 *
 * Provides structured, timestamped logging with level control.
 * Logs are written to stderr (so they don't interfere with stdout IPC)
 * and optionally to a file at ~/.oboto/tray-app.log.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started on port', 3000);
 *   logger.error('Failed to connect', err.message);
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const LOG_DIR = path.join(os.homedir(), '.oboto');
const LOG_FILE = path.join(LOG_DIR, 'tray-app.log');

/** Maximum log file size before rotation (5 MB). */
const MAX_LOG_SIZE = 5 * 1024 * 1024;

class Logger {
    /**
     * @param {object} [options]
     * @param {string} [options.level='info'] – minimum level to emit
     * @param {boolean} [options.file=true] – write to log file
     * @param {boolean} [options.stderr=true] – write to stderr
     */
    constructor(options = {}) {
        this.level = options.level || (process.argv.includes('--dev') ? 'debug' : 'info');
        this._fileEnabled = options.file !== false;
        this._stderrEnabled = options.stderr !== false;
        this._stream = null;

        if (this._fileEnabled) {
            this._ensureLogDir();
            this._rotateIfNeeded();
            this._stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
            this._stream.on('error', () => {
                // Disable file logging on write errors (disk full, permissions, etc.)
                // to prevent unhandled stream errors from crashing the Electron process.
                this._stream = null;
            });
        }
    }

    debug(tag, ...args) { this._log('debug', tag, args); }
    info(tag, ...args)  { this._log('info',  tag, args); }
    warn(tag, ...args)  { this._log('warn',  tag, args); }
    error(tag, ...args) { this._log('error', tag, args); }

    /**
     * Write a pre-formatted line (e.g. daemon output that already carries its
     * own tags/emojis) without adding a level/tag prefix.  Still respects the
     * minimum log level (treated as debug) and writes to file + stderr.
     * @param {string} line
     */
    passthrough(line) {
        if (LOG_LEVELS.debug < LOG_LEVELS[this.level]) return;

        if (this._stderrEnabled) {
            process.stderr.write(line + '\n');
        }
        if (this._stream) {
            this._stream.write(line + '\n');
        }
    }

    // ── Internal ──────────────────────────────────────────────

    _log(level, tag, args) {
        if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

        const ts = new Date().toISOString();
        const prefix = `${ts} [${level.toUpperCase()}] [${tag}]`;
        const message = args
            .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');

        const line = `${prefix} ${message}`;

        if (this._stderrEnabled) {
            process.stderr.write(line + '\n');
        }

        if (this._stream) {
            this._stream.write(line + '\n');
        }
    }

    _ensureLogDir() {
        try {
            if (!fs.existsSync(LOG_DIR)) {
                fs.mkdirSync(LOG_DIR, { recursive: true });
            }
        } catch {
            // If we can't create the dir, file logging is silently disabled
            this._fileEnabled = false;
        }
    }

    _rotateIfNeeded() {
        try {
            if (fs.existsSync(LOG_FILE)) {
                const stat = fs.statSync(LOG_FILE);
                if (stat.size > MAX_LOG_SIZE) {
                    const rotated = LOG_FILE + '.1';
                    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
                    fs.renameSync(LOG_FILE, rotated);
                }
            }
        } catch {
            // Rotation failure is non-critical
        }
    }
}

// Export a singleton so all modules share the same instance
module.exports = new Logger();

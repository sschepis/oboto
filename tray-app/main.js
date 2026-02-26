/**
 * Oboto Tray App — Electron main process
 *
 * Tray-only application (no visible window).  Manages the Oboto server
 * daemon as a child process, provides a system tray icon with status
 * indication and workspace management controls.
 */

const { app, Tray, Menu, dialog, shell, nativeImage, Notification } = require('electron');
const path = require('path');
const { Preferences } = require('./lib/preferences');
const { DaemonManager } = require('./lib/daemon-manager');
const { AutoStart } = require('./lib/auto-start');

// Prevent the app from showing in the Dock on macOS
if (process.platform === 'darwin') {
    app.dock.hide();
}

// ── Globals ──────────────────────────────────────────────────────────────

let tray = null;
let preferences = null;
let daemon = null;

/** Track whether we should auto-open the browser on the next 'running' state. */
let _pendingBrowserOpen = false;

// ── Icon helpers ─────────────────────────────────────────────────────────

function createTrayIcon() {
    // On macOS, use a monochrome white icon that blends with the menu bar.
    // The @2x variant is automatically picked up by Electron for Retina displays.
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    try {
        const icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
            return createFallbackIcon();
        }
        // Resize to 18x18 logical pixels for crisp menu-bar display
        return icon.resize({ width: 18, height: 18 });
    } catch {
        return createFallbackIcon();
    }
}

function createFallbackIcon() {
    // Fallback: create a simple 16x16 icon as a data URL
    const size = 16;
    const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="#22c55e"/>
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl);
}

// ── Menu builder ─────────────────────────────────────────────────────────

function buildContextMenu() {
    const currentWorkspace = preferences.get('currentWorkspace');
    // The daemon is considered usable once it reports 'running' state and has
    // a live server process — this happens as soon as "Server running at" is
    // detected in stdout, *before* the WS monitor connects.
    const hasWorkspace = !!currentWorkspace;
    const isRunning = daemon.state === 'running' && daemon.serverProcess !== null;
    const recentWorkspaces = preferences.getRecentWorkspaces();
    const port = preferences.get('port') || 3000;

    // Build recent workspaces submenu
    const recentItems = recentWorkspaces
        .filter(ws => ws !== currentWorkspace)
        .map(ws => ({
            label: ws,
            click: () => loadWorkspace(ws),
        }));

    if (recentItems.length === 0) {
        recentItems.push({ label: '(none)', enabled: false });
    }

    const statusLabel = isRunning
        ? `Running — ${currentWorkspace || 'no workspace'}`
        : hasWorkspace
            ? `Starting — ${currentWorkspace}`
            : 'Stopped';

    const template = [
        { label: `Oboto: ${statusLabel}`, enabled: false },
        { type: 'separator' },
        {
            label: 'Load Workspace...',
            click: () => pickWorkspace(),
        },
        {
            label: 'Recent Workspaces',
            submenu: recentItems,
        },
        { type: 'separator' },
        {
            label: 'Open in Browser',
            enabled: isRunning,
            click: () => shell.openExternal(`http://localhost:${port}`),
        },
        { type: 'separator' },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Open Browser on Workspace Load',
                    type: 'checkbox',
                    checked: preferences.get('openBrowserOnLoad') !== false,
                    click: (menuItem) => {
                        preferences.set('openBrowserOnLoad', menuItem.checked);
                    },
                },
                {
                    label: 'Auto-start on Login',
                    type: 'checkbox',
                    checked: AutoStart.isEnabled(),
                    click: (menuItem) => {
                        if (menuItem.checked) {
                            AutoStart.enable();
                            preferences.set('autoStart', true);
                        } else {
                            AutoStart.disable();
                            preferences.set('autoStart', false);
                        }
                    },
                },
                {
                    label: `Port: ${port}`,
                    enabled: false,
                },
            ],
        },
        { type: 'separator' },
        {
            label: 'Restart Service',
            enabled: isRunning,
            click: () => restartDaemon(),
        },
        {
            label: 'Stop Service',
            enabled: isRunning,
            click: () => stopDaemon(),
        },
        { type: 'separator' },
        {
            label: 'Quit Oboto',
            click: () => quit(),
        },
    ];

    return Menu.buildFromTemplate(template);
}

function refreshMenu() {
    if (tray) {
        tray.setContextMenu(buildContextMenu());
    }
}

// ── Icon state ───────────────────────────────────────────────────────────

function setTrayStatus(color, tooltip) {
    if (!tray) return;
    // Icon is always the bot icon; status is communicated via tooltip
    tray.setImage(createTrayIcon());
    tray.setToolTip(tooltip || 'Oboto');
}

// ── Workspace management ─────────────────────────────────────────────────

async function pickWorkspace() {
    const result = await dialog.showOpenDialog({
        title: 'Select Oboto Workspace',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Load Workspace',
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const selectedPath = result.filePaths[0];
    await loadWorkspace(selectedPath);
}

async function loadWorkspace(workspacePath) {
    try {
        setTrayStatus('yellow', `Starting — ${workspacePath}`);
        preferences.setCurrentWorkspace(workspacePath);

        // Flag so that the state-changed handler opens the browser once 'running'
        if (preferences.get('openBrowserOnLoad') !== false) {
            _pendingBrowserOpen = true;
        }

        await daemon.switchWorkspace(workspacePath);
        refreshMenu();

        // Show notification
        if (Notification.isSupported()) {
            new Notification({
                title: 'Oboto',
                body: `Workspace loaded: ${path.basename(workspacePath)}`,
            }).show();
        }
    } catch (err) {
        _pendingBrowserOpen = false;
        setTrayStatus('red', `Error: ${err.message}`);
        refreshMenu();

        if (Notification.isSupported()) {
            new Notification({
                title: 'Oboto Error',
                body: `Failed to load workspace: ${err.message}`,
            }).show();
        }
    }
}

async function restartDaemon() {
    setTrayStatus('yellow', 'Restarting...');
    try {
        await daemon.restart();
        refreshMenu();
    } catch (err) {
        setTrayStatus('red', `Restart failed: ${err.message}`);
        refreshMenu();
    }
}

async function stopDaemon() {
    await daemon.stop();
    setTrayStatus('yellow', 'Service stopped');
    refreshMenu();
}

async function quit() {
    await daemon.stop();
    app.quit();
}

// ── Application lifecycle ────────────────────────────────────────────────

app.whenReady().then(async () => {
    // Initialise preferences
    preferences = new Preferences();

    // Initialise daemon manager
    daemon = new DaemonManager(preferences);

    // Wire daemon events to tray
    daemon.on('state-changed', (state) => {
        switch (state) {
            case 'running':
                setTrayStatus('green', `Running — ${daemon.workspacePath || 'ready'}`);
                // Auto-open browser if a workspace was just loaded
                if (_pendingBrowserOpen) {
                    _pendingBrowserOpen = false;
                    const port = preferences.get('port') || 3000;
                    shell.openExternal(`http://localhost:${port}`);
                }
                break;
            case 'starting':
                setTrayStatus('yellow', 'Starting...');
                break;
            case 'stopped':
                _pendingBrowserOpen = false;
                setTrayStatus('yellow', 'Service stopped');
                break;
            case 'error':
                _pendingBrowserOpen = false;
                setTrayStatus('red', 'Service error');
                break;
        }
        refreshMenu();
    });

    daemon.on('task-completed', (payload) => {
        if (Notification.isSupported()) {
            new Notification({
                title: 'Oboto — Task Completed',
                body: payload.description || 'A background task has finished.',
            }).show();
        }
    });

    daemon.on('task-failed', (payload) => {
        if (Notification.isSupported()) {
            new Notification({
                title: 'Oboto — Task Failed',
                body: `${payload.description || 'A task'} failed: ${payload.error || 'unknown error'}`,
            }).show();
        }
    });

    daemon.on('log', (line) => {
        // In dev mode, print daemon logs to the Electron process stdout
        if (process.argv.includes('--dev')) {
            console.log(`[daemon] ${line}`);
        }
    });

    // Create the system tray
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Oboto — Initialising...');
    tray.setContextMenu(buildContextMenu());

    // If there's a saved workspace, auto-start the daemon
    const savedWorkspace = preferences.get('currentWorkspace');
    if (savedWorkspace) {
        try {
            setTrayStatus('yellow', `Starting — ${savedWorkspace}`);
            await daemon.start(savedWorkspace, preferences.get('port'));
        } catch (err) {
            setTrayStatus('red', `Failed to start: ${err.message}`);
        }
    } else {
        setTrayStatus('yellow', 'No workspace — click to load');
    }

    refreshMenu();
});

// Prevent app from quitting when all windows are closed (tray-only mode)
app.on('window-all-closed', (e) => {
    e.preventDefault();
});

// Handle second instance — show the tray menu or pick workspace
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // If user tries to open another instance, just focus the tray
        if (tray) {
            tray.popUpContextMenu();
        }
    });
}

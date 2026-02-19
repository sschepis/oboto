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

// ── Icon helpers ─────────────────────────────────────────────────────────

function getIconPath(color) {
    // On macOS, use Template images for dark/light menu bar support
    const suffix = process.platform === 'darwin' ? 'Template' : '';
    const filename = `tray-icon-${color}${suffix}.png`;
    return path.join(__dirname, 'assets', filename);
}

function createTrayIcon(color) {
    const iconPath = getIconPath(color);
    try {
        const icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
            // Fallback: create a simple coloured dot programmatically
            return createFallbackIcon(color);
        }
        // Resize for system tray (16x16 logical)
        return icon.resize({ width: 16, height: 16 });
    } catch {
        return createFallbackIcon(color);
    }
}

function createFallbackIcon(color) {
    // Create a simple 16x16 icon as a data URL
    const colors = {
        green: '#22c55e',
        yellow: '#eab308',
        red: '#ef4444',
    };
    const hex = colors[color] || colors.yellow;

    // Use a simple PNG buffer (16x16 coloured square)
    // For simplicity, create from a tiny data URL
    const size = 16;
    const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="${hex}"/>
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl);
}

// ── Menu builder ─────────────────────────────────────────────────────────

function buildContextMenu() {
    const currentWorkspace = preferences.get('currentWorkspace');
    const isRunning = daemon.isRunning();
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
    tray.setImage(createTrayIcon(color));
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
                break;
            case 'starting':
                setTrayStatus('yellow', 'Starting...');
                break;
            case 'stopped':
                setTrayStatus('yellow', 'Service stopped');
                break;
            case 'error':
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
    tray = new Tray(createTrayIcon('yellow'));
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

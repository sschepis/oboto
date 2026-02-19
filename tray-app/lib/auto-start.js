/**
 * Auto-start manager — registers / unregisters the Electron tray app
 * as a login item so it starts automatically when the user logs in.
 *
 * Uses Electron's built-in `app.setLoginItemSettings()` which handles:
 *   - macOS: Login Items (System Settings > General > Login Items)
 *   - Windows: Registry (HKCU\Software\Microsoft\Windows\CurrentVersion\Run)
 */

const { app } = require('electron');

class AutoStart {
    /**
     * Enable auto-start on login.
     */
    static enable() {
        app.setLoginItemSettings({
            openAtLogin: true,
            // On macOS, `openAsHidden` starts the app without showing any windows
            // (which is what we want for a tray-only app).
            openAsHidden: true,
        });
    }

    /**
     * Disable auto-start on login.
     */
    static disable() {
        app.setLoginItemSettings({
            openAtLogin: false,
        });
    }

    /**
     * Check whether auto-start is currently enabled.
     * @returns {boolean}
     */
    static isEnabled() {
        const settings = app.getLoginItemSettings();
        return settings.openAtLogin;
    }

    /**
     * Toggle auto-start on/off.
     * @returns {boolean} New state after toggle.
     */
    static toggle() {
        const current = AutoStart.isEnabled();
        if (current) {
            AutoStart.disable();
        } else {
            AutoStart.enable();
        }
        return !current;
    }
}

module.exports = { AutoStart };

import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';

/**
 * Oboto Notification Center Plugin
 *
 * Send alerts and notifications.
 * Ported from notaclaw/plugins/notification-center.
 *
 * @module @oboto/plugin-notification-center
 */

const DEFAULT_SETTINGS = {
  maxHistory: 100,
  soundEnabled: true,
  soundVolume: 0.5,
  dndEnabled: false,
  desktopNotifications: false,
  deduplicationWindowMs: 2000,
};

const SETTINGS_SCHEMA = [
  { key: 'maxHistory', label: 'Max History', type: 'number', description: 'Maximum number of notifications to keep in history', default: 100 },
  { key: 'soundEnabled', label: 'Sound Enabled', type: 'boolean', description: 'Enable notification sounds', default: true },
  { key: 'soundVolume', label: 'Sound Volume', type: 'number', description: 'Volume for notification sounds (0.0 to 1.0)', default: 0.5 },
  { key: 'dndEnabled', label: 'Do Not Disturb', type: 'boolean', description: 'Suppress notifications when enabled', default: false },
  { key: 'desktopNotifications', label: 'Desktop Notifications', type: 'boolean', description: 'Show desktop OS notifications', default: false },
  { key: 'deduplicationWindowMs', label: 'Deduplication Window (ms)', type: 'number', description: 'Time window in milliseconds to suppress duplicate notifications', default: 2000 },
];

export async function activate(api) {
  console.log('[notification-center] Activating...');

  let notifications = [];

  // Load notifications from storage
  try {
    const storedNotifications = await api.storage.get('notifications');
    if (Array.isArray(storedNotifications)) {
      notifications = storedNotifications;
    }
  } catch (err) {
    console.error('[notification-center] Failed to load storage:', err);
  }

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'notification-center', DEFAULT_SETTINGS, SETTINGS_SCHEMA
  );

  const persist = async () => {
    try {
      await api.storage.set('notifications', notifications);
    } catch (err) {
      console.error('[notification-center] Failed to save storage:', err);
    }
  };

  // ── Events Handlers ──────────────────────────────────────────────────────────

  api.events.onSystem('notification:send', async (data) => {
     const notification = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
      timestamp: Date.now(),
      title: data.title || 'Notification',
      message: data.message || '',
      type: data.type || 'info',
      priority: data.priority || 'medium',
      category: data.category || 'system',
      source: data.source || 'unknown',
      read: false,
      actions: data.actions || [],
      data: data.data
    };

    // Deduplication
    const dedupWindow = pluginSettings.deduplicationWindowMs || 2000;
    const duplicate = notifications.find(n => 
        n.title === notification.title && 
        n.message === notification.message && 
        n.timestamp > notification.timestamp - dedupWindow
    );

    if (duplicate) return;

    notifications.unshift(notification);
    if (notifications.length > pluginSettings.maxHistory) {
        notifications = notifications.slice(0, pluginSettings.maxHistory);
    }

    await persist();

    api.ws.broadcast('notification:new', notification);
  });

  // ── WS Handlers ──────────────────────────────────────────────────────────────

  api.ws.register('notifications:list', async (data, ctx) => {
    ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:list', payload: notifications }));
  });

  api.ws.register('notifications:markRead', async (data, ctx) => {
    let updated = false;
    if (data.id) {
        const n = notifications.find(x => x.id === data.id);
        if (n && !n.read) {
            n.read = true;
            updated = true;
            api.ws.broadcast('notification:update', n);
        }
    } else if (data.ids) {
        data.ids.forEach(id => {
            const n = notifications.find(x => x.id === id);
            if (n && !n.read) {
                n.read = true;
                updated = true;
                api.ws.broadcast('notification:update', n);
            }
        });
    }
    if (updated) await persist();
    ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:success', payload: { action: 'markRead' } }));
  });

  api.ws.register('notifications:markAllRead', async (data, ctx) => {
    let updated = false;
    notifications.forEach(n => {
        if (!n.read) {
            n.read = true;
            updated = true;
        }
    });
    if (updated) {
        await persist();
        api.ws.broadcast('notifications:allRead', {});
    }
    ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:success', payload: { action: 'markAllRead' } }));
  });

  api.ws.register('notifications:delete', async (data, ctx) => {
    const initialLength = notifications.length;
    if (data.id) {
        notifications = notifications.filter(n => n.id !== data.id);
    } else if (data.ids) {
        notifications = notifications.filter(n => !data.ids?.includes(n.id));
    }
    if (notifications.length !== initialLength) {
        await persist();
        api.ws.broadcast('notifications:listUpdated', notifications);
    }
    ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:success', payload: { action: 'delete' } }));
  });

  api.ws.register('notifications:clear', async (data, ctx) => {
    notifications = [];
    await persist();
    api.ws.broadcast('notifications:cleared', {});
    ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:success', payload: { action: 'clear' } }));
  });
  
  api.ws.register('notifications:getSettings', async (data, ctx) => {
      ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:settings', payload: pluginSettings }));
  });

  api.ws.register('notifications:updateSettings', async (data, ctx) => {
      Object.assign(pluginSettings, data.settings);
      await api.settings.setAll(pluginSettings);
      api.ws.broadcast('notifications:settingsUpdated', pluginSettings);
      ctx.ws.send(JSON.stringify({ type: 'plugin:notification-center:success', payload: { action: 'updateSettings' } }));
  });

  // ── Tool Registration ────────────────────────────────────────────────────────

  api.tools.register({
      useOriginalName: true,
      surfaceSafe: true,
      name: 'send_notification',
      description: 'Send an alert or notification to the user',
      parameters: {
          type: 'object',
          properties: {
              title: { type: 'string', description: 'Title of the notification' },
              message: { type: 'string', description: 'Content of the notification' },
              type: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: 'Type of notification' },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Priority level' }
          },
          required: ['title', 'message']
      },
      handler: async (args) => {
           const notification = {
              id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
              timestamp: Date.now(),
              title: args.title,
              message: args.message,
              type: args.type || 'info',
              priority: args.priority || 'medium',
              category: 'agent',
              source: 'agent',
              read: false
          };
          
          notifications.unshift(notification);
          if (notifications.length > pluginSettings.maxHistory) {
              notifications = notifications.slice(0, pluginSettings.maxHistory);
          }
          await persist();
          
          api.ws.broadcast('notification:new', notification);
          
          return { success: true, id: notification.id };
      }
  });

  console.log('[notification-center] Activated');
}

export async function deactivate(api) {
  console.log('[notification-center] Deactivated');
}

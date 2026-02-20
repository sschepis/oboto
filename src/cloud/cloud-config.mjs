// Cloud Configuration Loader
// Reads cloud settings from environment variables.
// Returns null if cloud is not configured (missing URL or key).

/**
 * Load cloud configuration from environment variables.
 * @returns {object|null} Cloud config object, or null if not configured
 */
export function loadCloudConfig() {
    const url = process.env.OBOTO_CLOUD_URL;
    const key = process.env.OBOTO_CLOUD_KEY;

    if (!url || !key) return null;

    return {
        baseUrl: url.replace(/\/$/, ''),  // Strip trailing slash
        anonKey: key,
        autoLogin: process.env.OBOTO_CLOUD_AUTO_LOGIN !== 'false',  // Default: true
        syncInterval: parseInt(process.env.OBOTO_CLOUD_SYNC_INTERVAL || '30000', 10),  // 30s
        presenceInterval: parseInt(process.env.OBOTO_CLOUD_PRESENCE_INTERVAL || '60000', 10),  // 60s
    };
}

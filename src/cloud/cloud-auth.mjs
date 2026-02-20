// CloudAuth — Authentication lifecycle manager for Oboto Cloud
// Handles login, logout, token refresh, and token caching via SecretsManager.
// Zero cloud SDK dependencies — uses CloudClient (native fetch) for all HTTP.

const REFRESH_TOKEN_KEY = 'OBOTO_CLOUD_REFRESH_TOKEN';
const REFRESH_BUFFER_SECONDS = 60; // Refresh 60s before expiry

/**
 * Manages authentication state: login, logout, automatic token refresh,
 * and persistent token caching through the existing SecretsManager vault.
 *
 * Emits events on the EventBus:
 *   cloud:auth:logged-in   { user, profile, org }
 *   cloud:auth:logged-out  {}
 *   cloud:auth:error       { error }
 */
export class CloudAuth {
    /**
     * @param {import('./cloud-client.mjs').CloudClient} client
     * @param {import('../lib/event-bus.mjs').AiManEventBus} eventBus
     * @param {import('../server/secrets-manager.mjs').SecretsManager} secretsManager
     */
    constructor(client, eventBus, secretsManager) {
        this.client = client;
        this.eventBus = eventBus;
        this.secretsManager = secretsManager;

        /** @type {{ id: string, email: string } | null} */
        this.user = null;

        /** @type {{ display_name: string, avatar_url: string|null, bio: string|null } | null} */
        this.profile = null;

        /** @type {{ id: string, name: string, slug: string, subscription_tier: string, subscription_status: string, max_members: number, max_workspaces: number } | null} */
        this.org = null;

        /** @type {{ org_id: string, role: string } | null} */
        this.membership = null;

        /** @type {string|null} */
        this.refreshToken = null;

        /** @type {ReturnType<typeof setTimeout>|null} */
        this._refreshTimer = null;
    }

    /**
     * Whether the user is currently logged in.
     * @returns {boolean}
     */
    isLoggedIn() {
        return !!this.user;
    }

    /**
     * Login with email and password.
     * On success: stores tokens, fetches profile + org, starts auto-refresh, caches token.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<void>}
     * @throws {Error} On auth failure
     */
    async login(email, password) {
        const result = await this.client.post(
            '/auth/v1/token?grant_type=password',
            { email, password }
        );

        this._applyAuthResult(result);
        await this._fetchUserContext();
        await this._cacheRefreshToken(this.refreshToken);

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:auth:logged-in', this.getSnapshot());
        }
    }

    /**
     * Try to auto-login from a cached refresh token.
     * Called on server startup. Silently returns false if no cached token
     * or if the refresh fails — never throws.
     * @returns {Promise<boolean>} true if auto-login succeeded
     */
    async tryAutoLogin() {
        try {
            const cachedToken = await this._loadCachedRefreshToken();
            if (!cachedToken) return false;

            this.refreshToken = cachedToken;
            await this.refresh();
            return true;
        } catch (err) {
            // Clear invalid cached token
            await this._clearCachedRefreshToken().catch(() => {});
            this.refreshToken = null;
            this.user = null;
            this.client.setAccessToken(null);
            return false;
        }
    }

    /**
     * Refresh the access token using the stored refresh token.
     * Updates the client access token, reschedules the next refresh,
     * and re-caches the new refresh token.
     * @returns {Promise<void>}
     * @throws {Error} If refresh fails (expired, revoked, etc.)
     */
    async refresh() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const result = await this.client.request('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: { refresh_token: this.refreshToken },
        });

        this._applyAuthResult(result);

        // Fetch user context if we don't have it yet (first auto-login)
        if (!this.profile) {
            await this._fetchUserContext();
        }

        await this._cacheRefreshToken(this.refreshToken);

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:auth:logged-in', this.getSnapshot());
        }
    }

    /**
     * Logout: invalidate the session, clear all tokens and state,
     * stop the refresh timer, clear the cached token.
     * @returns {Promise<void>}
     */
    async logout() {
        // Try to call the server logout endpoint (best-effort)
        try {
            if (this.client.accessToken) {
                await this.client.post('/auth/v1/logout');
            }
        } catch {
            // Ignore — we're logging out regardless
        }

        // Clear state
        this._clearRefreshTimer();
        this.user = null;
        this.profile = null;
        this.org = null;
        this.membership = null;
        this.refreshToken = null;
        this.client.setAccessToken(null);

        await this._clearCachedRefreshToken().catch(() => {});

        if (this.eventBus) {
            this.eventBus.emitTyped('cloud:auth:logged-out', {});
        }
    }

    /**
     * Get an auth state snapshot for status reporting.
     * Never includes tokens or secrets — only display-safe data.
     * @returns {object}
     */
    getSnapshot() {
        return {
            loggedIn: this.isLoggedIn(),
            user: this.user ? { id: this.user.id, email: this.user.email } : null,
            profile: this.profile
                ? { displayName: this.profile.display_name, avatarUrl: this.profile.avatar_url }
                : null,
            org: this.org
                ? {
                    id: this.org.id,
                    name: this.org.name,
                    slug: this.org.slug,
                    tier: this.org.subscription_tier,
                }
                : null,
            role: this.membership?.role || null,
        };
    }

    // ── Internal Methods ──────────────────────────────────────────────────

    /**
     * Apply the result of a token grant (login or refresh) to internal state.
     * @param {object} result — auth token response
     */
    _applyAuthResult(result) {
        this.client.setAccessToken(result.access_token);
        this.refreshToken = result.refresh_token;

        if (result.user) {
            this.user = {
                id: result.user.id,
                email: result.user.email,
            };
        }

        // Schedule the next refresh
        if (result.expires_in) {
            this._scheduleRefresh(result.expires_in);
        }
    }

    /**
     * Fetch the user's profile and organization membership.
     * Populates this.profile, this.org, this.membership.
     * @returns {Promise<void>}
     */
    async _fetchUserContext() {
        if (!this.user) return;

        // Fetch profile
        try {
            const profiles = await this.client.get(
                `/rest/v1/profiles?id=eq.${this.user.id}&select=*`
            );
            if (profiles && profiles.length > 0) {
                this.profile = profiles[0];
            }
        } catch (err) {
            // Profile fetch is non-critical — log but continue
            console.warn(`[CloudAuth] Failed to fetch profile: ${err.message}`);
        }

        // Fetch org membership
        try {
            const memberships = await this.client.get(
                `/rest/v1/org_memberships?user_id=eq.${this.user.id}&select=org_id,role,organizations(*)&order=joined_at.asc&limit=1`
            );
            if (memberships && memberships.length > 0) {
                const m = memberships[0];
                this.membership = { org_id: m.org_id, role: m.role };
                this.org = m.organizations || null;
            }
        } catch (err) {
            // Org fetch is non-critical
            console.warn(`[CloudAuth] Failed to fetch organization: ${err.message}`);
        }
    }

    /**
     * Schedule automatic token refresh before the current token expires.
     * @param {number} expiresIn — seconds until token expiry
     */
    _scheduleRefresh(expiresIn) {
        this._clearRefreshTimer();

        const refreshInMs = Math.max(
            (expiresIn - REFRESH_BUFFER_SECONDS) * 1000,
            10000 // At least 10s from now
        );

        this._refreshTimer = setTimeout(async () => {
            try {
                await this.refresh();
            } catch (err) {
                console.warn(`[CloudAuth] Token refresh failed: ${err.message}`);
                if (this.eventBus) {
                    this.eventBus.emitTyped('cloud:auth:error', {
                        error: `Token refresh failed: ${err.message}`,
                    });
                }
            }
        }, refreshInMs);

        // Don't keep the process alive just for token refresh
        if (this._refreshTimer.unref) {
            this._refreshTimer.unref();
        }
    }

    /**
     * Clear the refresh timer.
     */
    _clearRefreshTimer() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    /**
     * Cache the refresh token in SecretsManager vault.
     * @param {string} token
     * @returns {Promise<void>}
     */
    async _cacheRefreshToken(token) {
        if (!this.secretsManager || !token) return;
        try {
            await this.secretsManager.set(
                REFRESH_TOKEN_KEY,
                token,
                'Cloud',
                'Oboto Cloud refresh token (auto-managed)'
            );
        } catch (err) {
            console.warn(`[CloudAuth] Failed to cache refresh token: ${err.message}`);
        }
    }

    /**
     * Load the cached refresh token from SecretsManager vault.
     * @returns {Promise<string|null>}
     */
    async _loadCachedRefreshToken() {
        if (!this.secretsManager) return null;
        return this.secretsManager.get(REFRESH_TOKEN_KEY) || null;
    }

    /**
     * Clear the cached refresh token.
     * @returns {Promise<void>}
     */
    async _clearCachedRefreshToken() {
        if (!this.secretsManager) return;
        try {
            await this.secretsManager.delete(REFRESH_TOKEN_KEY);
        } catch {
            // Ignore — best effort
        }
    }
}

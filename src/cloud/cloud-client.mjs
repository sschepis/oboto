// CloudClient — Zero-dependency REST client for Oboto Cloud
// Uses native fetch(). No Supabase SDK. No cloud-specific packages.

/**
 * Generic REST client for communicating with the Oboto Cloud backend.
 * All methods throw on HTTP errors. Auth headers are added automatically
 * when an access token is set.
 */
export class CloudClient {
    /**
     * @param {string} baseUrl — Cloud base URL (e.g. "https://xyz.supabase.co")
     * @param {string} anonKey — Public anon API key
     */
    constructor(baseUrl, anonKey) {
        this.baseUrl = baseUrl;
        this.anonKey = anonKey;
        this.accessToken = null;
    }

    /**
     * Set the current access token (called by CloudAuth after login/refresh).
     * @param {string|null} token
     */
    setAccessToken(token) {
        this.accessToken = token;
    }

    /**
     * Core fetch wrapper. Adds apikey and Authorization headers automatically.
     * @param {string} path — URL path (e.g. "/rest/v1/profiles")
     * @param {object} [options] — fetch options
     * @param {string} [options.method] — HTTP method
     * @param {object|string} [options.body] — Request body (auto-stringified if object)
     * @param {object} [options.headers] — Additional headers
     * @returns {Promise<any>} Parsed JSON response, or null for 204
     * @throws {Error} On non-2xx status (error has .status and .url properties)
     */
    async request(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'apikey': this.anonKey,
            ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
            ...options.headers,
        };

        const url = `${this.baseUrl}${path}`;

        let body = undefined;
        if (options.body !== undefined && options.body !== null) {
            body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }

        const res = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`Cloud API ${res.status}: ${text}`);
            err.status = res.status;
            err.url = url;
            throw err;
        }

        // 204 No Content
        if (res.status === 204) return null;

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return res.json();
        }
        return res.text();
    }

    /**
     * GET request.
     * @param {string} path
     * @param {object} [headers]
     * @returns {Promise<any>}
     */
    get(path, headers) {
        return this.request(path, { method: 'GET', headers });
    }

    /**
     * POST request.
     * @param {string} path
     * @param {object|string} body
     * @param {object} [headers]
     * @returns {Promise<any>}
     */
    post(path, body, headers) {
        return this.request(path, { method: 'POST', body, headers });
    }

    /**
     * PATCH request. Includes Prefer: return=representation by default.
     * @param {string} path
     * @param {object|string} body
     * @param {object} [headers]
     * @returns {Promise<any>}
     */
    patch(path, body, headers) {
        return this.request(path, {
            method: 'PATCH',
            body,
            headers: { 'Prefer': 'return=representation', ...headers },
        });
    }

    /**
     * DELETE request.
     * @param {string} path
     * @param {object} [headers]
     * @returns {Promise<any>}
     */
    delete(path, headers) {
        return this.request(path, { method: 'DELETE', headers });
    }

    /**
     * Stream a POST request (for SSE responses like ai-proxy).
     * Returns an async generator that yields parsed SSE data objects.
     * @param {string} path
     * @param {object} body
     * @yields {object} Parsed JSON from each SSE data line
     */
    async *stream(path, body) {
        const headers = {
            'Content-Type': 'application/json',
            'apikey': this.anonKey,
            ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
        };

        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(`Cloud API stream ${res.status}: ${text}`);
            err.status = res.status;
            throw err;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIdx;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIdx).trim();
                buffer = buffer.slice(newlineIdx + 1);

                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') return;

                try {
                    yield JSON.parse(jsonStr);
                } catch {
                    // Skip partial or malformed JSON chunks
                }
            }
        }
    }
}

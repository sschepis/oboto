/**
 * Resolves a relative backend URL (e.g. `/generated-images/foo.png`) to an
 * absolute URL pointing at the Express backend server.
 *
 * In production the UI is served by the same Express server on port 3000, so
 * relative paths resolve correctly. During development the UI runs on the Vite
 * dev server (port 5173+), so relative paths like `/generated-images/…` would
 * 404 unless we either proxy them (see vite.config.ts) or rewrite the URL here.
 *
 * This helper acts as a defence-in-depth measure: even if the Vite proxy is
 * misconfigured or the page is accessed from an unexpected origin, images will
 * still load.
 */

const BACKEND_PORT = 3000;

export function resolveBackendUrl(src: string | undefined): string | undefined {
  if (!src) return src;

  // Only rewrite paths that are served by the Express backend
  const backendPrefixes = ['/generated-images'];

  const needsRewrite = backendPrefixes.some((prefix) => src.startsWith(prefix));
  if (!needsRewrite) return src;

  // If we're already on the backend port (production) or if the protocol is
  // file://, just return the original path — it will resolve correctly.
  const currentPort = window.location.port;
  if (currentPort === String(BACKEND_PORT) || currentPort === '') {
    return src;
  }

  // Development mode: rewrite to the Express backend origin
  return `${window.location.protocol}//localhost:${BACKEND_PORT}${src}`;
}

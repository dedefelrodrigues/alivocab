/** Only same-app relative paths are allowed as post-login redirects (no open redirects). */
export function safeRedirect(target: string | undefined, fallback = '/'): string {
  if (!target) return fallback;
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('/login') || path.startsWith('/register') ? fallback : path;
  } catch {
    return fallback;
  }
}

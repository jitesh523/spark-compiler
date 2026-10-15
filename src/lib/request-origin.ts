/** Compare a browser Origin with the public request host, including proxied Vercel requests. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  // Command-line clients do not send Origin. Browsers send it for our JSON POSTs.
  if (!origin) return true;
  try {
    const requestURL = new URL(request.url);
    const isVercel = process.env.VERCEL === "1";
    const forwardedHost = isVercel ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
    const forwardedProtocol = isVercel ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
    const host = forwardedHost || request.headers.get("host") || requestURL.host;
    const protocol = forwardedProtocol ? `${forwardedProtocol}:` : requestURL.protocol;
    if (protocol !== "http:" && protocol !== "https:") return false;
    const expected = new URL(`${protocol}//${host}`);
    if (expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash) return false;
    return new URL(origin).origin === expected.origin;
  } catch {
    return false;
  }
}

/**
 * Cloudflare Worker that proxies the two read-only rubygems.org paths the
 * playground uses and adds the CORS headers rubygems.org does not send there.
 */
const UPSTREAM = "https://rubygems.org";
const PROXIED_PATH = /^\/(?:info\/[\w.-]+|gems\/[\w.-]+\.gem)$/;
// A published name-version.gem never changes; index entries change whenever
// a new version is released.
const GEM_MAX_AGE = 60 * 60 * 24 * 365;
const INFO_MAX_AGE = 60 * 5;

export type Env = {
  /** Comma-separated origins allowed to read responses, e.g. https://ruby-play.dev. */
  ALLOWED_ORIGINS: string;
};

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  return origin && allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : { Vary: "Origin" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET" },
      });
    if (request.method !== "GET")
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...cors, Allow: "GET, OPTIONS" },
      });
    const url = new URL(request.url);
    if (url.search || !PROXIED_PATH.test(url.pathname))
      return new Response("Not found", { status: 404, headers: cors });
    const gem = url.pathname.startsWith("/gems/");
    const maxAge = gem ? GEM_MAX_AGE : INFO_MAX_AGE;
    // Cloudflare's cache answers repeats, sparing rubygems.org; `cf` is a
    // Workers-only fetch option.
    const upstream = await fetch(`${UPSTREAM}${url.pathname}`, {
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: { "200-299": maxAge, "404": 60, "500-599": 0 },
      },
    } as RequestInit);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": upstream.ok
          ? `public, max-age=${maxAge}${gem ? ", immutable" : ""}`
          : "no-store",
      },
    });
  },
};

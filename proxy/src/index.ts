/**
 * Cloudflare Worker that proxies the two read-only rubygems.org paths the
 * playground uses and adds the CORS headers rubygems.org does not send there.
 * The routes are the contract with the app, which calls them through Hono's
 * RPC client typed by AppType.
 */
import { Hono } from "hono";

const UPSTREAM = "https://rubygems.org";
// A published name-version.gem never changes; index entries change whenever
// a new version is released.
const GEM_MAX_AGE = 60 * 60 * 24 * 365;
const INFO_MAX_AGE = 60 * 5;

export type Env = {
  /** Comma-separated origins allowed to read responses, e.g. https://ruby-play.dev. */
  ALLOWED_ORIGINS: string;
};

async function fromRubygems(
  path: string,
  maxAge: number,
  immutable: boolean,
): Promise<Response> {
  // Cloudflare's cache answers repeats, sparing rubygems.org; `cf` is a
  // Workers-only fetch option.
  const upstream = await fetch(`${UPSTREAM}${path}`, {
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": maxAge, "404": 60, "500-599": 0 },
    },
  } as RequestInit);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": upstream.ok
        ? `public, max-age=${maxAge}${immutable ? ", immutable" : ""}`
        : "no-store",
    },
  });
}

// Plain parameters keep the RPC client's keys as `:name` and `:file`; their
// shape is checked in the handlers so anything else is a 404, as for unknown
// paths.
const GEM_NAME = /^[\w.-]+$/;
const GEM_FILE = /^[\w.-]+\.gem$/;

// One chain, so the route types reach AppType.
const app = new Hono<{ Bindings: Env }>()
  // Every response, errors included, varies by Origin and carries CORS only
  // for an allowed origin.
  .use("*", async (c, next) => {
    await next();
    const origin = c.req.header("Origin");
    const allowed = c.env.ALLOWED_ORIGINS.split(",").map((value) =>
      value.trim(),
    );
    c.res.headers.set("Vary", "Origin");
    if (origin && allowed.includes(origin))
      c.res.headers.set("Access-Control-Allow-Origin", origin);
  })
  .options("*", (c) =>
    c.body(null, 204, { "Access-Control-Allow-Methods": "GET" }),
  )
  // Only plain GETs reach rubygems.org: other methods get 405, and query
  // strings are refused rather than silently dropped.
  .use("*", async (c, next) => {
    if (c.req.method !== "GET")
      return c.text("Method not allowed", 405, { Allow: "GET, OPTIONS" });
    if (new URL(c.req.url).search) return c.text("Not found", 404);
    await next();
  })
  .get("/info/:name", (c) => {
    const name = c.req.param("name");
    return GEM_NAME.test(name)
      ? fromRubygems(`/info/${name}`, INFO_MAX_AGE, false)
      : c.text("Not found", 404);
  })
  .get("/gems/:file", (c) => {
    const file = c.req.param("file");
    return GEM_FILE.test(file)
      ? fromRubygems(`/gems/${file}`, GEM_MAX_AGE, true)
      : c.text("Not found", 404);
  });
app.notFound((c) => c.text("Not found", 404));

/** The contract the app's RPC client is typed against. */
export type AppType = typeof app;

export default app;

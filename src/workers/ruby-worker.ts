import ruby40Url from "@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm?url";
import ruby34Url from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url";
import ruby33Url from "@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm?url";
import ruby32Url from "@ruby/3.2-wasm-wasi/dist/ruby+stdlib.wasm?url";
import rubyHeadUrl from "@ruby/head-wasm-wasi/dist/ruby+stdlib.wasm?url";
import { isRubyVersion, type RubyVersion } from "../versions";
import { executeRuby } from "../runtime";
import { parseGemfile, type GemSource, type ResolvedGem } from "../gems";

const rubyUrls: Record<RubyVersion, string> = {
  "4.0": ruby40Url,
  "3.4": ruby34Url,
  "3.3": ruby33Url,
  "3.2": ruby32Url,
  "4.1": rubyHeadUrl,
};

// The Cloudflare Worker in proxy/ forwards rubygems.org and adds CORS headers.
// Development talks to `npm run proxy:dev`; VITE_GEM_PROXY_URL overrides both.
const GEM_PROXY: string =
  import.meta.env.VITE_GEM_PROXY_URL ??
  (import.meta.env.DEV
    ? "http://127.0.0.1:8787"
    : "https://gems.ruby-play.dev");
// A published name-version.gem never changes, so cached copies stay valid.
// Index entries do change and are always fetched fresh.
const GEM_CACHE = "ruby-playground-gems-v1";

async function fetchFromProxy(path: string, notFound: string) {
  const response = await fetch(`${GEM_PROXY}${path}`);
  // rubygems.org answers a missing .gem with 403 from its storage, not 404.
  if (response.status === 404 || response.status === 403)
    throw new Error(notFound);
  if (!response.ok)
    throw new Error(`Gem download failed: ${path} (${response.status}).`);
  return response;
}

/** Cache Storage can be missing or refuse writes; the gem is then just fetched. */
async function openGemCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === "undefined"
      ? undefined
      : await caches.open(GEM_CACHE);
  } catch {
    return undefined;
  }
}

// Downloads wait here until every gem has been extracted, so a truncated or
// otherwise broken download never reaches the cache.
const pendingCache: [url: string, bytes: ArrayBuffer][] = [];

async function cacheInstalledGems(): Promise<void> {
  const cache = await openGemCache();
  await Promise.all(
    pendingCache.map(([url, bytes]) =>
      cache?.put(url, new Response(bytes)).catch(() => undefined),
    ),
  );
  pendingCache.length = 0;
}

async function loadGem(
  fileName: string,
  announce?: (line: string) => void,
): Promise<Uint8Array> {
  const url = `${GEM_PROXY}/gems/${fileName}`;
  const cache = await openGemCache();
  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    announce?.(`Using ${fileName} (cached)`);
    return new Uint8Array(await cached.arrayBuffer());
  }
  announce?.(`Fetching ${fileName}`);
  const bytes = await (
    await fetchFromProxy(
      `/gems/${fileName}`,
      `${fileName} was not found on rubygems.org.`,
    )
  ).arrayBuffer();
  pendingCache.push([url, bytes]);
  return new Uint8Array(bytes);
}

const gemSource: GemSource = {
  fetchInfo: async (name) =>
    (
      await fetchFromProxy(
        `/info/${name}`,
        `gem "${name}" was not found on rubygems.org.`,
      )
    ).text(),
  fetchGem: (fileName) => loadGem(fileName),
};

const LOCKED_NAME = /^[\w.-]+$/;
const LOCKED_VERSION = /^\d[\dA-Za-z.]*$/;
const log = (line: string) => self.postMessage({ type: "log", line });

/** bundle install shows each download; a run only reports its result. */
const installSource: GemSource = {
  fetchInfo: (name) => {
    log(`Fetching gem metadata: ${name}`);
    return gemSource.fetchInfo(name);
  },
  fetchGem: (fileName) => loadGem(fileName, log),
};

self.onmessage = async (
  event: MessageEvent<{
    code: string;
    version: RubyVersion;
    gemfile?: string;
    lock?: ResolvedGem[];
    mode?: "run" | "install";
  }>,
) => {
  try {
    if (!isRubyVersion(event.data.version))
      throw new Error("Unsupported Ruby version.");
    const install = event.data.mode === "install";
    const requests = parseGemfile(event.data.gemfile ?? "");
    // Names and versions become proxy URL paths, so re-check what the page sent.
    const locked = event.data.lock?.every(
      (gem) =>
        LOCKED_NAME.test(gem.name) &&
        LOCKED_VERSION.test(gem.version) &&
        (gem.source === "rubygems" || gem.source === "builtin"),
    )
      ? event.data.lock
      : undefined;
    // Runs never resolve: changing the Gemfile requires an explicit install.
    if (!install && requests.length > 0 && !locked)
      throw new Error(
        "Gemfile.lock is missing or does not match the Gemfile. Run bundle install from the Gemfile tab.",
      );
    if (install)
      log(
        requests.length > 0
          ? "Resolving dependencies..."
          : "The Gemfile lists no gems.",
      );
    const response = await fetch(rubyUrls[event.data.version]);
    if (!response.ok)
      throw new Error(`Ruby download failed (${response.status}).`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const result = await executeRuby(
      module,
      event.data.code,
      install
        ? undefined
        : (info) => {
            self.postMessage({ type: "runtime-info", info });
          },
      {
        ...(install ? installSource : gemSource),
        requests,
        locked: install ? undefined : locked,
        onResolved: (gems) => {
          self.postMessage({ type: "gems", gems });
          log(`Resolved ${gems.length} gems.`);
        },
        onInstalled: cacheInstalledGems,
      },
    );
    if (install && !result.error) log("Bundle complete!");
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      stdout: "",
      stderr: "",
      output: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

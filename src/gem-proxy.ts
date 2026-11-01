import { hc } from "hono/client";
import type { AppType } from "../proxy/src/index";
import { GEM_FILE, GEM_NAME } from "../proxy/src/gem-name";

export { GEM_FILE, GEM_NAME };

export function createGemProxy(baseUrl: string, fetcher?: typeof fetch) {
  const client = hc<AppType>(baseUrl, fetcher ? { fetch: fetcher } : undefined);
  return {
    gemUrl(file: string): URL {
      if (!GEM_FILE.test(file))
        throw new Error(`Invalid gem file name: ${file}`);
      return client.gems[":file"].$url({ param: { file } });
    },
    async fetchInfo(name: string): Promise<Response> {
      if (!GEM_NAME.test(name)) throw new Error(`Invalid gem name: ${name}`);
      return client.info[":name"].$get({ param: { name } });
    },
    async fetchGem(file: string): Promise<Response> {
      if (!GEM_FILE.test(file))
        throw new Error(`Invalid gem file name: ${file}`);
      return client.gems[":file"].$get({ param: { file } });
    },
  };
}

export async function requireGemResponse(
  request: Promise<Response>,
  path: string,
  notFound: string,
  connectionFailure: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await request;
  } catch (cause) {
    throw new Error(connectionFailure, { cause });
  }
  // rubygems.org answers a missing .gem with 403 from its storage, not 404.
  if (response.status === 404 || response.status === 403)
    throw new Error(notFound);
  if (!response.ok)
    throw new Error(`Gem download failed: ${path} (${response.status}).`);
  return response;
}

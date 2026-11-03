import { createGemProxy } from "../src/index";

const RUBYGEMS_ORIGIN = "https://rubygems.org";
const FIXTURE_ORIGIN = "http://127.0.0.1:18787";

const fixtureFetch: typeof fetch = async (input, init) => {
  const requestUrl = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (requestUrl.origin !== RUBYGEMS_ORIGIN)
    throw new Error("Fixture proxy received an unexpected upstream URL.");
  return fetch(new URL(requestUrl.pathname, FIXTURE_ORIGIN), init);
};

export default createGemProxy(fixtureFetch);

const MISSING = /cannot load such file -- ([\w./-]+)/;

export function requires(code: string, feature: string): boolean {
  const quoted = feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\brequire\\s*\\(?\\s*["']${quoted}["']`).test(code);
}

/**
 * The feature a LoadError reported, only when main.rb requires it directly.
 * Which gem provides it is left to the user: require paths and gem names do
 * not map one to one, and guessing can pick an unrelated gem of that name.
 */
export function missingRequire(
  error: string | undefined,
  code: string,
): string | undefined {
  const feature = error ? MISSING.exec(error)?.[1] : undefined;
  // A missing extension inside an installed gem is not fixed by the Gemfile.
  if (!feature || /\.(so|bundle)$/.test(feature)) return undefined;
  return requires(code, feature) ? feature : undefined;
}

/** rubygems.org search rejects "/"; "rack test" finds rack-test, "rack/test" errors. */
export function searchQuery(feature: string): string {
  return feature.replaceAll("/", " ");
}

export function searchUrl(feature: string): string {
  return `https://rubygems.org/search?query=${encodeURIComponent(searchQuery(feature))}`;
}

const MISSING_EXTENSION =
  /cannot load such file -- ([\w./-]+\.(?:so|bundle))\b/;
const INSTALLED_GEM = /\/gems\/installed\/([\w.-]+?)-(\d[\dA-Za-z.]*)\//;
export const ISSUES_URL =
  "https://github.com/glassmonkey/ruby-playground/issues";

export type MissingExtension = {
  extension: string;
  /** The installed gem whose code asked for the extension, when the backtrace shows it. */
  gem?: { name: string; version: string };
};

/** A native extension a gem needs; the WASM build cannot load extensions added later. */
export function missingExtension(
  error: string | undefined,
): MissingExtension | undefined {
  const extension = error ? MISSING_EXTENSION.exec(error)?.[1] : undefined;
  if (!error || !extension) return undefined;
  const gem = INSTALLED_GEM.exec(error);
  return gem
    ? { extension, gem: { name: gem[1], version: gem[2] } }
    : { extension };
}

export function extensionIssueUrl(found: MissingExtension): string {
  const subject = found.gem
    ? `the ${found.gem.name} gem`
    : `the ${found.extension} extension`;
  const title = `Support ${subject} (native extension)`;
  return `${ISSUES_URL}/new?title=${encodeURIComponent(title)}`;
}

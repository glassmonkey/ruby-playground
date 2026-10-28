/** Only pinned, bundled ruby.wasm builds are selectable. */
export const RUBY_VERSIONS = ["4.0", "3.4", "3.3", "3.2", "4.1"] as const;
export type RubyVersion = (typeof RUBY_VERSIONS)[number];
export const DEFAULT_RUBY_VERSION: RubyVersion = "4.0";
export function isRubyVersion(value: unknown): value is RubyVersion {
  return RUBY_VERSIONS.some((version) => version === value);
}
export const RUBY_PATCH_VERSIONS: Record<RubyVersion, string> = {
  "4.0": "4.0.0",
  "3.4": "3.4.1",
  "3.3": "3.3.3",
  "3.2": "3.2.4",
  "4.1": "4.1.0",
};

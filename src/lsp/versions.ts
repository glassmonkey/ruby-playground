import type { RubyVersion } from "../versions";

export const LSP_RUBY_VERSIONS = ["3.3", "4.0"] as const;
export type LspRubyVersion = (typeof LSP_RUBY_VERSIONS)[number];

export function isLspRubyVersion(
  version: RubyVersion,
): version is LspRubyVersion {
  return LSP_RUBY_VERSIONS.some((supported) => supported === version);
}

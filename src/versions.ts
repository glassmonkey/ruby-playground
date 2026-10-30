type RubyReleaseMetadata = {
  id: string;
  patch: string;
  reference: string;
  channel: "stable" | "development";
};

/** Only pinned, bundled ruby.wasm builds are selectable. */
const releases = [
  { id: "4.0", patch: "4.0.0", reference: "4.0", channel: "stable" },
  { id: "3.4", patch: "3.4.1", reference: "3.4", channel: "stable" },
  { id: "3.3", patch: "3.3.3", reference: "3.3", channel: "stable" },
  { id: "3.2", patch: "3.2.4", reference: "3.2", channel: "stable" },
  { id: "4.1", patch: "4.1.0", reference: "master", channel: "development" },
] as const satisfies readonly RubyReleaseMetadata[];

export type RubyVersion = (typeof releases)[number]["id"];
export const RUBY_RELEASES = releases.map((release) => ({
  ...release,
  label: `Ruby ${release.id}${release.channel === "development" ? " development" : ""}`,
}));
export const RUBY_VERSIONS = RUBY_RELEASES.map((release) => release.id);
export const RUBY_PATCH_VERSIONS = Object.fromEntries(
  RUBY_RELEASES.map((release) => [release.id, release.patch]),
) as Record<RubyVersion, string>;

const newestStable = RUBY_RELEASES.filter(
  (release) => release.channel === "stable",
).sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }))[0];
if (!newestStable)
  throw new Error("At least one stable Ruby release is required");
export const DEFAULT_RUBY_VERSION: RubyVersion = newestStable.id;

export function isRubyVersion(value: unknown): value is RubyVersion {
  return RUBY_VERSIONS.some((version) => version === value);
}

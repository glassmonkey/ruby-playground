import {
  DEFAULT_RUBY_VERSION,
  isRubyVersion,
  type RubyVersion,
} from "./versions";
import LZString from "lz-string";
import type { ResolvedGem } from "./gems";
import { GEM_NAME } from "./gem-proxy";
const { compressToEncodedURIComponent } = LZString;

export const MAX_SOURCE_LENGTH = 50_000;
export const MAX_COMPRESSED_LENGTH = 100_000;
export const MAX_SHARE_URL_BYTES = 8_000;
export const MAX_GEMFILE_LENGTH = 5_000;
export const MAX_LOCKED_GEMS = 200;
export type ShareState = {
  code: string;
  version?: RubyVersion;
  gemfile?: string;
  /** Resolved versions; only kept while a Gemfile is present. */
  lock?: ResolvedGem[];
};
export type ParsedShareState = ShareState & {
  version: RubyVersion;
  gemfile: string;
  warning?: string;
};

const LOCK_LINE = /^([^ ]+) (\d[\dA-Za-z.]*)( builtin)?$/;

/** One `name version[ builtin]` line per gem: a minimal Gemfile.lock. */
function formatLock(lock: ResolvedGem[]): string {
  return lock
    .map(
      ({ name, version, source }) =>
        `${name} ${version}${source === "builtin" ? " builtin" : ""}`,
    )
    .join("\n");
}

function parseLock(text: string): ResolvedGem[] {
  const lines = text.split("\n");
  if (lines.length > MAX_LOCKED_GEMS) throw new Error("Too many locked gems");
  return lines.map((line) => {
    const match = LOCK_LINE.exec(line);
    if (!match || !GEM_NAME.test(match[1]))
      throw new Error("Invalid lock line");
    return {
      name: match[1],
      version: match[2],
      source: match[3] ? "builtin" : "rubygems",
    };
  });
}

const URI_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";

/** Decode the lz-string URI bitstream with a hard output/allocation budget.
 * Each dictionary entry is a previously emitted phrase plus one character,
 * so the sum of dictionary string lengths is bounded by twice the output cap.
 * Unlike decompressFromEncodedURIComponent, malformed/truncated streams throw.
 */
function decodeBounded(input: string): string {
  let bitOffset = 0;
  function readBits(count: number): number {
    if (bitOffset + count > input.length * 6) {
      throw new Error("Truncated compressed source");
    }
    let value = 0;
    for (let i = 0; i < count; i++, bitOffset++) {
      const digit = URI_ALPHABET.indexOf(input[Math.floor(bitOffset / 6)]);
      value += ((digit >> (5 - (bitOffset % 6))) & 1) * 2 ** i;
    }
    return value;
  }

  const first = readBits(2);
  if (first === 2) return "";
  if (first !== 0 && first !== 1) throw new Error("Invalid first symbol");
  let previous = String.fromCharCode(readBits(first === 0 ? 8 : 16));
  const dictionary: string[] = [];
  dictionary[3] = previous;
  let dictionarySize = 4;
  let width = 3;
  let remaining = 4;
  const result = [previous];
  let outputLength = previous.length;

  for (;;) {
    let symbol = readBits(width);
    if (symbol === 2) return result.join("");
    if (symbol === 0 || symbol === 1) {
      dictionary[dictionarySize++] = String.fromCharCode(
        readBits(symbol === 0 ? 8 : 16),
      );
      symbol = dictionarySize - 1;
      remaining--;
    }
    if (remaining === 0) {
      remaining = 2 ** width;
      width++;
    }
    const known = dictionary[symbol];
    // Check the next phrase's size before creating or retaining it.
    const entryLength = known?.length ?? previous.length + 1;
    if (outputLength + entryLength > MAX_SOURCE_LENGTH) {
      throw new Error("Source exceeds the 50,000-character limit");
    }
    let entry: string;
    if (known !== undefined) entry = known;
    else if (symbol === dictionarySize) entry = previous + previous[0];
    else throw new Error("Invalid dictionary reference");
    result.push(entry);
    outputLength += entry.length;
    dictionary[dictionarySize++] = previous + entry[0];
    remaining--;
    previous = entry;
    if (remaining === 0) {
      remaining = 2 ** width;
      width++;
    }
  }
}

/** Invalid source is never executed: the caller receives its supplied fallback. */
export function parseShareUrl(
  url: string | URL,
  fallbackCode: string,
): ParsedShareState {
  const state: ParsedShareState = {
    code: fallbackCode,
    version: DEFAULT_RUBY_VERSION,
    gemfile: "",
  };
  let parsed: URL;
  try {
    parsed = new URL(url.toString());
  } catch {
    return {
      ...state,
      warning: "Invalid share URL. The default code was restored.",
    };
  }
  const warnings: string[] = [];
  const version = parsed.searchParams.get("v");
  if (isRubyVersion(version)) state.version = version;
  else if (version !== null) {
    warnings.push("Unsupported Ruby version; using Ruby 4.0.");
  }
  const compressed = parsed.searchParams.get("c");
  if (compressed !== null) {
    try {
      state.code = decodeCompressed(compressed);
    } catch {
      warnings.push(
        "Shared code is invalid or exceeds the 50,000-character limit. The default code was restored.",
      );
    }
  }
  const compressedGemfile = parsed.searchParams.get("g");
  if (compressedGemfile !== null) {
    try {
      const gemfile = decodeCompressed(compressedGemfile);
      if (gemfile.length > MAX_GEMFILE_LENGTH) throw new Error("Too long");
      state.gemfile = gemfile;
    } catch {
      warnings.push(
        "Shared Gemfile is invalid or exceeds the 5,000-character limit. The Gemfile was cleared.",
      );
    }
  }
  const compressedLock = parsed.searchParams.get("l");
  // A lock without its Gemfile has nothing to pin; drop it silently.
  if (compressedLock !== null && state.gemfile) {
    try {
      state.lock = parseLock(decodeCompressed(compressedLock));
    } catch {
      warnings.push(
        "Shared gem versions are invalid. Gems will be resolved again.",
      );
    }
  }
  if (warnings.length) state.warning = warnings.join(" ");
  return state;
}

function decodeCompressed(compressed: string): string {
  // Reject before decoding or allocating a decoded dictionary. URLSearchParams
  // converts literal plus to space; lz-string's URI decoder does the same fix.
  if (compressed.length === 0 || compressed.length > MAX_COMPRESSED_LENGTH) {
    throw new Error("Invalid compressed length");
  }
  const normalized = compressed.replace(/ /g, "+");
  if (!/^[A-Za-z0-9+\-$]+$/.test(normalized)) {
    throw new Error("Invalid compressed alphabet");
  }
  const decoded = decodeBounded(normalized);
  // Reject trailing garbage and ambiguous or corrupted bitstreams.
  if (compressToEncodedURIComponent(decoded) !== normalized) {
    throw new Error("Noncanonical compressed source");
  }
  return decoded;
}

/** Return an absolute share URL without dropping unrelated query/hash state. */
export function buildShareUrl(url: string | URL, state: ShareState): string {
  if (state.code.length > MAX_SOURCE_LENGTH) {
    throw new Error("Code exceeds the 50,000-character sharing limit.");
  }
  const compressed = compressToEncodedURIComponent(state.code);
  if (compressed.length > MAX_COMPRESSED_LENGTH) {
    throw new Error("Compressed code exceeds the sharing limit.");
  }
  const result = new URL(url.toString());
  result.searchParams.set("c", compressed);
  const version = state.version ?? DEFAULT_RUBY_VERSION;
  if (!isRubyVersion(version)) throw new Error("Unsupported Ruby version.");
  result.searchParams.set("v", version);
  if ((state.gemfile ?? "").length > MAX_GEMFILE_LENGTH) {
    throw new Error("Gemfile exceeds the 5,000-character sharing limit.");
  }
  if (state.gemfile) {
    result.searchParams.set("g", compressToEncodedURIComponent(state.gemfile));
  } else {
    result.searchParams.delete("g");
  }
  if (state.gemfile && state.lock?.length) {
    result.searchParams.set(
      "l",
      compressToEncodedURIComponent(formatLock(state.lock)),
    );
  } else {
    result.searchParams.delete("l");
  }
  // Ignore legacy HTML-preview settings; all output is now plain text.
  result.searchParams.delete("f");
  const shareUrl = result.toString();
  if (new TextEncoder().encode(shareUrl).byteLength > MAX_SHARE_URL_BYTES) {
    throw new Error(
      "The code is too long to save in the URL. Please shorten it.",
    );
  }
  return shareUrl;
}

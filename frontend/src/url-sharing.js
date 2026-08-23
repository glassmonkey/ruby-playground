import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

// ADR-0011: instant sharing goes through the URL's `c` param (lz-string
// compressed code), no DB involved.

export function decodeSharedCode(search) {
  const param = new URLSearchParams(search).get("c") ?? "";
  return decompressFromEncodedURIComponent(param);
}

export function urlSearchWithCode(search, code) {
  const params = new URLSearchParams(search);
  params.set("c", compressToEncodedURIComponent(code));
  return `?${params.toString()}`;
}

import { urlSearchWithCode } from "./url-sharing.js";

// A saved snippet is a managed record; its code travels to the playground the
// same way any other shared code does -- through the lz-string `c` param
// (ADR-0011) -- so the snippet page never becomes a second carrier of code.
// Building the link here keeps lz-string out of Rails entirely.
function linkSnippetToPlayground() {
  const link = document.getElementById("open-in-playground");
  const code = document.getElementById("snippet-code");
  if (!link || !code) return;

  link.href = `/${urlSearchWithCode("", code.textContent)}`;
}

// Same two entry points as the playground bundle: import time covers the visit
// that first loads this file, turbo:load covers every later one. Rewriting the
// href twice is harmless, so this needs no guard.
linkSnippetToPlayground();
document.addEventListener("turbo:load", linkSnippetToPlayground);

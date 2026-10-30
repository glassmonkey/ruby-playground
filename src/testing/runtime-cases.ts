/** Independently recorded identities of the pinned WASM artifacts, not VM output. */
export const runtimeCases = [
  {
    version: "4.0",
    patch: "4.0.0",
    package: "@ruby/4.0-wasm-wasi",
    releaseDate: "2025-12-25",
    revision: "553f1675f3a9cece340b90f374a4245dccac2272",
  },
  {
    version: "3.4",
    patch: "3.4.1",
    package: "@ruby/3.4-wasm-wasi",
    releaseDate: "2024-12-25",
    revision: "48d4efcb85000e1ebae42004e963b5d0cedddcf2",
  },
  {
    version: "3.3",
    patch: "3.3.3",
    package: "@ruby/3.3-wasm-wasi",
    releaseDate: "2024-06-12",
    revision: "f1c7b6f435f1167a0514b39a5f72f55cec4d1426",
  },
  {
    version: "3.2",
    patch: "3.2.4",
    package: "@ruby/3.2-wasm-wasi",
    releaseDate: "2024-04-23",
    revision: "af471c0e0127eea0cafa6f308c0425bbfab0acf5",
  },
  {
    version: "4.1",
    patch: "4.1.0",
    package: "@ruby/head-wasm-wasi",
    releaseDate: "2026-10-28",
    revision: "79de9be7d8bfdf8d573ceda4fdc98a478fabf9e4",
  },
] as const;

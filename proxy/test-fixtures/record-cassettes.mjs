import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

if (process.env.RUBYGEMS_CASSETTE_RECORD !== "1") {
  console.error(
    "Recording is disabled. Set RUBYGEMS_CASSETTE_RECORD=1 to make the fixed public GET requests.",
  );
  process.exitCode = 1;
} else {
  const SOURCE = "https://rubygems.org";
  const CASSETTE_DIRECTORY = new URL("./cassettes/", import.meta.url);
  const allowedHeaders = [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "vary",
  ];
  const paths = [
    { path: "/info/rainbow", file: "info/rainbow.body", status: 200 },
    { path: "/info/pastel", file: "info/pastel.body", status: 200 },
    { path: "/info/tty-color", file: "info/tty-color.body", status: 200 },
    {
      path: "/info/gla183-vcr-missing-20261101",
      file: "info/gla183-vcr-missing-20261101.body",
      status: 404,
    },
    {
      path: "/gems/rainbow-3.1.1.gem",
      file: "gems/rainbow-3.1.1.gem",
      status: 200,
      package: "rainbow 3.1.1",
      license: "MIT",
    },
    {
      path: "/gems/pastel-0.8.0.gem",
      file: "gems/pastel-0.8.0.gem",
      status: 200,
      package: "pastel 0.8.0",
      license: "MIT",
    },
    {
      path: "/gems/tty-color-0.6.0.gem",
      file: "gems/tty-color-0.6.0.gem",
      status: 200,
      package: "tty-color 0.6.0",
      license: "MIT",
    },
    {
      path: "/gems/rainbow-0.0.1.gem",
      file: "gems/rainbow-0.0.1.body",
      status: 403,
    },
  ];
  const captured = [];

  function normalizeBody(path, rawBody) {
    if (path !== "/gems/rainbow-0.0.1.gem")
      return { body: rawBody, normalizations: [] };
    let text = rawBody.toString("utf8");
    const rawRequestId = /<RequestId>[^<]*<\/RequestId>/;
    const rawHostId = /<HostId>[^<]*<\/HostId>/;
    if (!rawRequestId.test(text) || !rawHostId.test(text))
      throw new Error(
        "Expected volatile XML identifiers in missing-gem response.",
      );
    text = text
      .replace(rawRequestId, "<RequestId>fixture-request-id</RequestId>")
      .replace(rawHostId, "<HostId>fixture-host-id</HostId>");
    return {
      body: Buffer.from(text),
      normalizations: [
        "XML RequestId value replaced with fixture-request-id",
        "XML HostId value replaced with fixture-host-id",
      ],
    };
  }

  for (const request of paths) {
    const url = `${SOURCE}${request.path}`;
    const recordedAt = new Date().toISOString();
    const response = await fetch(url, {
      headers: { "Accept-Encoding": "identity" },
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (response.status !== request.status) {
      throw new Error(
        `${request.path} returned ${response.status}; expected ${request.status}. Cassette files were not updated.`,
      );
    }
    const rawBodyHash = createHash("sha256").update(body).digest("hex");
    const normalized = normalizeBody(request.path, body);
    const headers = Object.fromEntries(
      allowedHeaders.flatMap((name) => {
        const value = response.headers.get(name)?.trim();
        return value === undefined ? [] : [[name, value]];
      }),
    );
    if (normalized.normalizations.length > 0) delete headers["content-length"];
    const bodyHash = createHash("sha256").update(normalized.body).digest("hex");
    captured.push({
      request,
      recordedAt,
      url,
      response,
      rawBodyBytes: body.byteLength,
      rawBodyHash,
      body: normalized.body,
      normalizations: normalized.normalizations,
      headers,
      bodyHash,
    });
  }

  const responses = {};
  for (const item of captured) {
    const bodyPath = new URL(item.request.file, CASSETTE_DIRECTORY);
    await mkdir(new URL("./", bodyPath), { recursive: true });
    await writeFile(bodyPath, item.body);
    responses[`GET ${item.request.path}`] = {
      url: item.url,
      finalUrl: item.response.url,
      recordedAt: item.recordedAt,
      status: item.response.status,
      headers: item.headers,
      body: {
        file: item.request.file,
        bytes: item.body.byteLength,
        sha256: item.bodyHash,
        rawBytes: item.rawBodyBytes,
        rawSha256: item.rawBodyHash,
        normalizations: item.normalizations,
        ...(item.request.package ? { package: item.request.package } : {}),
        ...(item.request.license ? { license: item.request.license } : {}),
      },
    };
    console.log(
      `${responses[`GET ${item.request.path}`].status} GET ${item.request.path} ${item.body.byteLength} bytes sha256:${item.bodyHash}`,
    );
  }

  const manifest = {
    schemaVersion: 1,
    recordedAt: captured[0].recordedAt,
    source: SOURCE,
    capture: {
      method: "GET",
      redirects: "followed",
      retries: 0,
      headers: {
        normalize: "lowercase names and trim surrounding value whitespace",
        captured: allowedHeaders,
        excluded: [
          "date",
          "server",
          "via",
          "x-amz-request-id",
          "x-amz-id-2",
          "x-request-id",
          "x-runtime",
          "x-backend",
          "x-served-by",
          "x-cache",
          "x-cache-hits",
          "x-timer",
        ],
      },
      bodyHash:
        "body.rawSha256 is the source response before documented body normalizations",
      replayBodyHash:
        "body.sha256 is the exact on-disk replay body; body.rawSha256 is the source response before documented body normalizations",
    },
    packages: {
      "rainbow 3.1.1": {
        license: "MIT",
        licenseSource: "embedded gemspec",
        licenseFile: "licenses/rainbow-3.1.1-LICENSE",
        licenseFileSha256:
          "a02553249a5fd0a57263ebc80bdd2cd366f5db751cac99587bee775c3c968a5b",
        runtimeDependencies: [],
      },
      "pastel 0.8.0": {
        license: "MIT",
        licenseSource: "embedded gemspec",
        licenseFile: "licenses/pastel-0.8.0-LICENSE.txt",
        licenseFileSha256:
          "c0ae109c24dbd66f2597bb261b4ece82e0b7a664b00b11dc29e3485d2996d930",
        runtimeDependencies: ["tty-color ~> 0.5"],
      },
      "tty-color 0.6.0": {
        license: "MIT",
        licenseSource: "embedded gemspec",
        licenseFile: "licenses/tty-color-0.6.0-LICENSE.txt",
        licenseFileSha256:
          "d6cb5ff5fe0412eb4f13ce892e50cee0e32bc9c4fedc84d7f970d1132c535b23",
        runtimeDependencies: [],
      },
    },
    responses,
  };
  await writeFile(
    new URL("./manifest.json", CASSETTE_DIRECTORY),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

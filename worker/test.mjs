import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = (await import(new URL("./index.js", import.meta.url).href)).default;
const app = await import(new URL("./public/app.js", import.meta.url).href);

const files = new Map([
  ["/config.html", "<!doctype html><title>config</title>"],
  ["/catalog.json", JSON.stringify({ schema: 8, catalogs: {} })],
]);
const env = {
  ASSETS: {
    async fetch(request) {
      const body = files.get(new URL(request.url).pathname);
      return body ? new Response(body) : new Response("missing", { status: 404 });
    },
  },
};

let upstream = "";
globalThis.fetch = async (url) => {
  upstream = String(url);
  return new Response("script body", { status: 200 });
};

async function call(path, userAgent = "curl/8") {
  const response = await worker.fetch(
    new Request(`https://worker.test${path}`, { headers: { "user-agent": userAgent } }),
    env,
  );
  return { status: response.status, headers: response.headers, body: await response.text() };
}

let result = await call("/config");
assert.equal(result.status, 200);
assert.match(result.body, /title>config/);
assert.ok(result.headers.get("content-security-policy"));

result = await call("/api/catalog");
assert.equal(result.status, 200);
assert.match(result.headers.get("content-type"), /application\/json/);
assert.equal(JSON.parse(result.body).schema, 8);

result = await call("/");
assert.equal(result.body, "script body");
assert.match(upstream, /\/install\.sh\?bucket=\d+$/);

result = await call("/", "WindowsPowerShell/5.1");
assert.match(upstream, /\/install\.ps1\?bucket=\d+$/);

result = await call("/?os=unix", "WindowsPowerShell/5.1");
assert.match(upstream, /\/install\.sh\?bucket=\d+$/);

result = await call("/install.ps1");
assert.match(upstream, /\/install\.ps1\?bucket=\d+$/);
assert.equal(result.headers.get("cache-control"), "no-store");

result = await call("/health");
assert.equal(result.body.trim(), "ok");

result = await call("/missing");
assert.equal(result.status, 404);

for (const [path, upstreamUrl, type] of [
  ["/repo.tar.gz", "codeload.github.com/", "application/gzip"],
  ["/repo.zip", "codeload.github.com/", "application/zip"],
]) {
  result = await call(path);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), new RegExp(type));
  assert.ok(upstream.includes(upstreamUrl));
}

const noAssets = await worker.fetch(new Request("https://worker.test/config"), {});
assert.equal(noAssets.status, 500);

const catalog = JSON.parse(readFileSync(new URL("./public/catalog.json", import.meta.url)));
assert.ok(catalog.schema >= 8);
assert.ok(catalog.catalogs.arch.mirrors.fields.some((field) => field.id === "pypi"));
assert.ok(catalog.catalogs.windows.mirrors.fields.some((field) => field.id === "scoop"));
for (const osName of ["windows", "fedora"]) {
  const ids = catalog.catalogs[osName].apps.map((app) => app.id);
  assert.ok(!ids.includes("script:herdr-core"), `${osName} should not include script:herdr-core`);
  assert.ok(ids.includes("script:herdr-tui"), `${osName} missing script:herdr-tui`);
  assert.ok(!ids.includes("winget:Paseo.Paseo"), `${osName} should not include winget:Paseo.Paseo`);
  assert.ok(!ids.includes("npm:@getpaseo/cli"), `${osName} should not include npm:@getpaseo/cli`);
  assert.ok(!ids.includes("release:paseo"), `${osName} should not include release:paseo`);
}
for (const forbidden of ["script:herdr-core", "script:herdr-tui", "npm:@getpaseo/cli"]) {
  assert.ok(
    !catalog.catalogs.debian.apps.some((app) => app.id === forbidden),
    `debian should not include ${forbidden}`,
  );
}
assert.ok(
  catalog.catalogs.debian.apps.some((app) => app.id === "pkg:npm"),
  "debian missing pkg:npm",
);
assert.ok(
  catalog.catalogs.debian.apps.some((app) => app.id === "npm:@earendil-works/pi-coding-agent"),
  "debian missing npm:@earendil-works/pi-coding-agent",
);
assert.ok(
  catalog.catalogs.debian.configs.some((cfg) => cfg.id === "pi"),
  "debian missing pi config",
);
assert.ok(
  catalog.catalogs.fedora.apps.some((app) => app.id === "script:tailscale"),
  "fedora missing script:tailscale",
);
assert.ok(
  catalog.catalogs.fedora.apps.some((app) => app.id === "script:magpie"),
  "fedora missing script:magpie",
);
assert.ok(
  catalog.catalogs.windows.apps.some((app) => app.id === "winget:Tailscale.Tailscale"),
  "windows missing winget:Tailscale.Tailscale",
);
assert.ok(
  catalog.catalogs.windows.apps.some((app) => app.id === "scoop:magpie/magpie-app"),
  "windows missing scoop:magpie/magpie-app",
);

const allApps = ["pkg:zsh", "font:maple"];
const allConfigs = ["zshrc", "tmux"];
const base = { origin: "https://o", osName: "arch", allApps, allConfigs };

let command = app.buildCommand({ ...base, apps: allApps, configs: allConfigs });
assert.equal(command, "curl -fsSL https://o/install.sh | sh");

command = app.buildCommand({ ...base, apps: ["pkg:zsh"], configs: ["tmux"] });
assert.equal(
  command,
  "curl -fsSL https://o/install.sh | sh -s -- -y --apps pkg:zsh --configs tmux",
);

command = app.buildCommand({
  ...base,
  apps: allApps,
  configs: allConfigs,
  mirrorProfile: "cn",
  defaultProfile: "global",
  mirrorFlags: ["--mirror-npm https://example"],
});
assert.equal(
  command,
  "curl -fsSL https://o/install.sh | sh -s -- -y --mirror cn --mirror-npm https://example",
);

command = app.buildCommand({
  ...base,
  osName: "windows",
  apps: allApps,
  configs: allConfigs,
});
assert.equal(command, "irm https://o/install.ps1 | iex");

const multi = { origin: "https://o", allApps: ["a", "b", "c"], allConfigs: ["x", "y", "z"] };
assert.equal(
  app.buildCommand({ ...multi, osName: "windows", apps: ["a", "b"], configs: ["x", "y"] }),
  '& ([scriptblock]::Create((irm https://o/install.ps1))) -y --apps "a,b" --configs "x,y"',
);
assert.ok(
  app
    .buildCommand({ ...multi, osName: "arch", apps: ["a", "b"], configs: ["x"] })
    .includes('--apps "a,b"'),
);

const fields = [
  { id: "github", type: "list" },
  { id: "npm", type: "text" },
  { id: "pypi", type: "list" },
];
const defaults = {
  github: ["https://a", "https://b"],
  npm: "https://r",
  pypi: ["https://p1"],
};
let values = { github: "https://a\nhttps://b", npm: "https://r", pypi: "https://p1" };
assert.deepEqual(app.buildMirrorFlags(fields, defaults, values), []);

values = { github: "https://a\nhttps://z", npm: "", pypi: "https://p1\nhttps://p2" };
assert.deepEqual(app.buildMirrorFlags(fields, defaults, values), [
  '--mirror-github "https://a,https://z"',
  "--mirror-npm none",
  '--mirror-pypi "https://p1,https://p2"',
]);

assert.deepEqual(app.buildProxyFlag("", ""), []);
assert.deepEqual(app.buildProxyFlag("", "socks5://127.0.0.1:1080"), [
  "--proxy socks5://127.0.0.1:1080",
]);
assert.deepEqual(app.buildProxyFlag("http://a", ""), ["--proxy none"]);

console.log("worker tests passed");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = (await import(new URL("./index.js", import.meta.url).href)).default;
const app = await import(new URL("./public/app.js", import.meta.url).href);

const files = new Map([
  ["/config.html", "<!doctype html><title>config</title>"],
  ["/catalog.json", JSON.stringify({ schema: 7, catalogs: {} })],
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
assert.equal(JSON.parse(result.body).schema, 7);

result = await call("/");
assert.equal(result.body, "script body");
assert.ok(upstream.endsWith("/install.sh"));

result = await call("/", "WindowsPowerShell/5.1");
assert.ok(upstream.endsWith("/install.ps1"));

result = await call("/?os=unix", "WindowsPowerShell/5.1");
assert.ok(upstream.endsWith("/install.sh"));

result = await call("/install.ps1");
assert.ok(upstream.endsWith("/install.ps1"));

result = await call("/health");
assert.equal(result.body.trim(), "ok");

result = await call("/missing");
assert.equal(result.status, 404);

const noAssets = await worker.fetch(new Request("https://worker.test/config"), {});
assert.equal(noAssets.status, 500);

const catalog = JSON.parse(readFileSync(new URL("./public/catalog.json", import.meta.url)));
assert.ok(catalog.schema >= 7);
assert.ok(catalog.catalogs.arch.mirrors.fields.some((field) => field.id === "pypi"));
assert.ok(catalog.catalogs.windows.mirrors.fields.some((field) => field.id === "scoop"));

const allApps = ["pkg:zsh", "font:maple"];
const allConfigs = ["zshrc", "tmux"];
const base = { origin: "https://o", osName: "arch", allApps, allConfigs };

let command = app.buildCommand({ ...base, apps: allApps, configs: allConfigs });
assert.equal(command, "curl -fsSL https://o/install.sh | sh -s -- -a -y");

command = app.buildCommand({ ...base, apps: ["pkg:zsh"], configs: ["tmux"] });
assert.equal(
  command,
  "curl -fsSL https://o/install.sh | sh -s -- -a -y --apps pkg:zsh --configs tmux",
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
  "curl -fsSL https://o/install.sh | sh -s -- -a -y --mirror-profile cn --mirror-npm https://example",
);

command = app.buildCommand({
  ...base,
  osName: "windows",
  apps: allApps,
  configs: allConfigs,
});
assert.equal(
  command,
  "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; " +
    "irm https://o/install.ps1 -OutFile install.ps1; .\\install.ps1 -a -y",
);

const multi = { origin: "https://o", allApps: ["a", "b", "c"], allConfigs: ["x", "y", "z"] };
assert.equal(
  app.buildCommand({ ...multi, osName: "windows", apps: ["a", "b"], configs: ["x", "y"] }),
  'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; ' +
    "irm https://o/install.ps1 -OutFile install.ps1; .\\install.ps1 -a -y --apps \"a,b\" --configs \"x,y\"",
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

/**
 * SrP-Dotfiles install endpoint + configurator.
 *
 *   GET /                 installer matching the client OS
 *   GET /config           HTML configurator (assets)
 *   GET /api/catalog      unit catalog JSON (assets)
 *   GET /install.sh       Unix bootstrap
 *   GET /install.ps1      Windows bootstrap
 *   GET /health           health probe
 *
 * Windows clients (PowerShell / Windows UA) get install.ps1, everything else
 * gets install.sh. Force a target with ?os=windows or ?os=unix.
 *
 * Deploy from this directory:
 *
 *   npx wrangler deploy
 */
const SOURCE = "https://raw.githubusercontent.com/RolinShmily/srp-dotfiles/main";
const CACHE_SECONDS = 300;

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": `public, max-age=${CACHE_SECONDS}`,
  "x-content-type-options": "nosniff",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": `public, max-age=${CACHE_SECONDS}`,
  "x-content-type-options": "nosniff",
};

function wantsWindows(request) {
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  return ua.includes("powershell") || ua.includes("windows") || ua.includes("winhttp");
}

async function serveAsset(request, env, path, headers) {
  if (!env || !env.ASSETS) {
    return new Response("Assets binding is not configured\n", { status: 500, headers: TEXT_HEADERS });
  }
  const assetUrl = new URL(path, request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!response.ok) {
    return new Response("Not available\n", { status: 502, headers: TEXT_HEADERS });
  }
  return new Response(response.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok\n", { headers: TEXT_HEADERS });
    }
    if (url.pathname === "/config" || url.pathname === "/config/") {
      return serveAsset(request, env, "/config.html", HTML_HEADERS);
    }
    if (url.pathname === "/api/catalog") {
      return serveAsset(request, env, "/catalog.json", JSON_HEADERS);
    }

    let name;
    if (url.pathname === "/install.sh") {
      name = "install.sh";
    } else if (url.pathname === "/install.ps1") {
      name = "install.ps1";
    } else if (url.pathname === "/" || url.pathname === "") {
      const forced = url.searchParams.get("os");
      const windows = forced ? forced.toLowerCase() === "windows" : wantsWindows(request);
      name = windows ? "install.ps1" : "install.sh";
    } else {
      return new Response("Not found. Try /config, /install.sh or /install.ps1\n", {
        status: 404,
        headers: TEXT_HEADERS,
      });
    }

    const upstream = await fetch(`${SOURCE}/${name}`, {
      cf: { cacheEverything: true, cacheTtl: CACHE_SECONDS },
    });
    if (!upstream.ok) {
      return new Response(`Installer unavailable (upstream ${upstream.status})\n`, {
        status: 502,
        headers: TEXT_HEADERS,
      });
    }

    return new Response(upstream.body, { status: 200, headers: TEXT_HEADERS });
  },
};

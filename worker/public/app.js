const state = {
  catalog: null,
  os: "arch",
  apps: new Set(),
  configs: new Set(),
  mirrorProfile: "",
  mirrorValues: {},
  proxyValue: "",
};

function fieldDisplay(field, value) {
  if (field.type === "list") {
    return Array.isArray(value) ? value.join("\n") : String(value || "");
  }
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function fieldArg(field, text) {
  if (field.type === "list") {
    return text
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join(",");
  }
  return text.trim();
}

function shellArg(value) {
  if (!/\s/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildMirrorFlags(fields, defaultValues, values) {
  const flags = [];
  for (const field of fields) {
    const fallback = fieldDisplay(field, defaultValues[field.id]);
    const text = values[field.id] ?? fallback;
    const current = fieldArg(field, text);
    if (current === fieldArg(field, fallback)) continue;
    flags.push(`--mirror-${field.id} ${current === "" ? "none" : shellArg(current)}`);
  }
  return flags;
}

export function buildProxyFlag(defaultProxy, value) {
  const fallback = (defaultProxy || "").trim();
  const current = (value || "").trim();
  if (current === fallback) return [];
  return [`--proxy ${current === "" ? "none" : shellArg(current)}`];
}

export function buildCommand({
  origin,
  osName,
  allApps,
  allConfigs,
  apps,
  configs,
  mirrorProfile = "",
  defaultProfile = "",
  mirrorFlags = [],
}) {
  const parts = [];
  if (apps.length !== allApps.length) {
    parts.push(`--apps ${apps.length ? apps.join(",") : "none"}`);
  }
  if (configs.length !== allConfigs.length) {
    parts.push(`--configs ${configs.length ? configs.join(",") : "none"}`);
  }
  if (mirrorProfile && mirrorProfile !== defaultProfile) {
    parts.push(`--mirror-profile ${mirrorProfile}`);
  }
  parts.push(...mirrorFlags);

  const tail = parts.length ? ` ${parts.join(" ")}` : "";
  if (osName === "windows") {
    return `irm ${origin}/install.ps1 -OutFile install.ps1; .\\install.ps1 -a -y${tail}`;
  }
  return `curl -fsSL ${origin}/install.sh | sh -s -- -a -y${tail}`;
}

function detectOs() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("android")) return "termux";
  return "arch";
}

function current() {
  return state.catalog?.catalogs?.[state.os] || {
    apps: [],
    configs: [],
    mirrors: { default: "", fields: [], profiles: {} },
  };
}

function mirrorData() {
  return current().mirrors || { default: "", fields: [], profiles: {} };
}

function profileValues(profile = state.mirrorProfile) {
  return mirrorData().profiles?.[profile] || {};
}

function row(unit, selected) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = unit.id;
  box.checked = selected.has(unit.id);
  box.addEventListener("change", () => {
    if (box.checked) selected.add(unit.id);
    else selected.delete(unit.id);
    updateCommand();
  });
  label.append(box, ` ${unit.label}`);
  wrapper.append(label);
  return wrapper;
}

function renderApps() {
  const host = document.getElementById("apps");
  host.replaceChildren();
  const groups = new Map();
  for (const app of current().apps) {
    if (!groups.has(app.source)) groups.set(app.source, []);
    groups.get(app.source).push(app);
  }
  for (const [source, apps] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = source;
    host.append(heading);
    for (const app of apps) host.append(row(app, state.apps));
  }
}

function renderList(hostId, items, selected) {
  const host = document.getElementById(hostId);
  host.replaceChildren();
  for (const item of items) host.append(row(item, selected));
}

function renderMirrors() {
  const data = mirrorData();
  const profileSelect = document.getElementById("mirrorProfile");
  profileSelect.replaceChildren();
  for (const profile of Object.keys(data.profiles || {})) {
    const option = document.createElement("option");
    option.value = profile;
    option.textContent = profile;
    option.selected = profile === state.mirrorProfile;
    profileSelect.append(option);
  }

  const host = document.getElementById("mirrors");
  host.replaceChildren();

  const proxyRow = document.createElement("p");
  proxyRow.className = "mirror-field";
  const proxyLabel = document.createElement("label");
  proxyLabel.textContent = "Proxy (all downloads)";
  proxyLabel.htmlFor = "mirror-proxy";
  const proxyInput = document.createElement("input");
  proxyInput.id = "mirror-proxy";
  proxyInput.type = "text";
  proxyInput.size = 50;
  proxyInput.value = state.proxyValue;
  proxyInput.addEventListener("input", () => {
    state.proxyValue = proxyInput.value;
    updateCommand();
  });
  const proxyReset = document.createElement("button");
  proxyReset.type = "button";
  proxyReset.textContent = "reset";
  proxyReset.addEventListener("click", () => {
    state.proxyValue = data.proxy || "";
    proxyInput.value = state.proxyValue;
    updateCommand();
  });
  proxyRow.append(proxyLabel, document.createElement("br"), proxyInput, " ", proxyReset);
  host.append(proxyRow);

  for (const field of data.fields || []) {
    const wrapper = document.createElement("p");
    wrapper.className = "mirror-field";

    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = `mirror-${field.id}`;

    const control = document.createElement(field.type === "list" ? "textarea" : "input");
    control.id = `mirror-${field.id}`;
    control.value = state.mirrorValues[field.id] ?? fieldDisplay(field, profileValues()[field.id]);
    if (field.type === "list") {
      const lines = control.value.split("\n").length;
      control.rows = Math.min(Math.max(lines, 3), 8);
      control.cols = 50;
      control.scrollTop = 0;
    } else {
      control.type = "text";
      control.size = 50;
    }
    control.addEventListener("input", () => {
      state.mirrorValues[field.id] = control.value;
      updateCommand();
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "reset";
    reset.addEventListener("click", () => {
      const fallback = fieldDisplay(field, profileValues()[field.id]);
      state.mirrorValues[field.id] = fallback;
      control.value = fallback;
      updateCommand();
    });

    wrapper.append(label, document.createElement("br"), control, " ", reset);
    host.append(wrapper);
  }
}

function render() {
  const osSelect = document.getElementById("os");
  osSelect.replaceChildren();
  for (const profile of Object.keys(state.catalog?.catalogs || {})) {
    const option = document.createElement("option");
    option.value = profile;
    option.textContent = profile;
    option.selected = profile === state.os;
    osSelect.append(option);
  }
  renderApps();
  renderList("configs", current().configs, state.configs);
  renderMirrors();
  updateCommand();
}

function updateCommand() {
  const data = current();
  const apps = data.apps.map((item) => item.id).filter((id) => state.apps.has(id));
  const configs = data.configs.map((item) => item.id).filter((id) => state.configs.has(id));
  const mirrorFlags = [
    ...buildMirrorFlags(mirrorData().fields || [], profileValues(), state.mirrorValues),
    ...buildProxyFlag(mirrorData().proxy || "", state.proxyValue),
  ];
  const command = buildCommand({
    origin: location.origin,
    osName: state.os,
    allApps: data.apps.map((item) => item.id),
    allConfigs: data.configs.map((item) => item.id),
    apps,
    configs,
    mirrorProfile: state.mirrorProfile,
    defaultProfile: mirrorData().default || "",
    mirrorFlags,
  });
  document.getElementById("command").value = command;
  document.getElementById("copyStatus").textContent = "";
}

function selectAll(group, value) {
  const data = current();
  const ids = (data[group] || []).map((item) => item.id);
  state[group] = new Set(value ? ids : []);
  render();
}

function resetMirrors() {
  const data = mirrorData();
  state.mirrorProfile = data.default || Object.keys(data.profiles || {})[0] || "";
  state.mirrorValues = {};
  state.proxyValue = data.proxy || "";
  for (const field of data.fields || []) {
    state.mirrorValues[field.id] = fieldDisplay(field, profileValues()[field.id]);
  }
}

async function copyCommand() {
  const text = document.getElementById("command").value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const control = document.getElementById("command");
    control.select();
    document.execCommand("copy");
  }
  document.getElementById("copyStatus").textContent = "copied";
}

async function init() {
  state.os = detectOs();
  document.getElementById("os").addEventListener("change", (event) => {
    state.os = event.target.value;
    const data = current();
    state.apps = new Set(data.apps.map((item) => item.id));
    state.configs = new Set(data.configs.map((item) => item.id));
    resetMirrors();
    render();
  });
  document.getElementById("mirrorProfile").addEventListener("change", (event) => {
    state.mirrorProfile = event.target.value;
    state.mirrorValues = {};
    for (const field of mirrorData().fields || []) {
      state.mirrorValues[field.id] = fieldDisplay(field, profileValues()[field.id]);
    }
    renderMirrors();
    updateCommand();
  });
  for (const group of ["apps", "configs"]) {
    document.getElementById(`${group}All`).addEventListener("click", () => selectAll(group, true));
    document.getElementById(`${group}None`).addEventListener("click", () => selectAll(group, false));
  }
  document.getElementById("copy").addEventListener("click", copyCommand);

  try {
    const response = await fetch("/api/catalog", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.catalog = await response.json();
  } catch {
    document.getElementById("command").value = "Could not load /api/catalog.";
    return;
  }

  const profiles = Object.keys(state.catalog.catalogs || {});
  if (!profiles.includes(state.os)) state.os = profiles[0] || "arch";
  const data = current();
  state.apps = new Set(data.apps.map((item) => item.id));
  state.configs = new Set(data.configs.map((item) => item.id));
  resetMirrors();
  render();
}

if (typeof document !== "undefined") {
  init();
}

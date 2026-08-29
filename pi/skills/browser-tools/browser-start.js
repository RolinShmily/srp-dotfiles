#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const useProfile = process.argv[2] === "--profile";

if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const SCRAPING_DIR = `${process.env.HOME}/.cache/browser-tools`;

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Chrome already running on :9222");
	process.exit(0);
} catch {}

// Setup profile directory
execSync(`mkdir -p "${SCRAPING_DIR}"`, { stdio: "ignore" });

// Remove SingletonLock to allow new instance
try {
	execSync(`rm -f "${SCRAPING_DIR}/SingletonLock" "${SCRAPING_DIR}/SingletonSocket" "${SCRAPING_DIR}/SingletonCookie"`, { stdio: "ignore" });
} catch {}

function findChromeExecutable() {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
		return process.env.CHROME_PATH;
	}
	const candidates = [
		"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
		"/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		"/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function findDefaultProfileDir() {
	const candidates = [
		`${process.env.HOME}/Library/Application Support/Google/Chrome/`,
		`/mnt/c/Users/${process.env.USER || "Rolin"}/AppData/Local/Google/Chrome/User Data/`,
		`${process.env.HOME}/.config/google-chrome/`,
		`${process.env.HOME}/.config/chromium/`,
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

const chromeExe = findChromeExecutable();
if (!chromeExe) {
	console.error("✗ Could not find Chrome executable. Please set CHROME_PATH environment variable.");
	process.exit(1);
}

if (useProfile) {
	const defaultProfileDir = findDefaultProfileDir();
	if (defaultProfileDir) {
		console.log(`Syncing profile from ${defaultProfileDir}...`);
		execSync(
			`rsync -a --delete \
				--exclude='SingletonLock' \
				--exclude='SingletonSocket' \
				--exclude='SingletonCookie' \
				--exclude='*/Sessions/*' \
				--exclude='*/Current Session' \
				--exclude='*/Current Tabs' \
				--exclude='*/Last Session' \
				--exclude='*/Last Tabs' \
				"${defaultProfileDir}" "${SCRAPING_DIR}/"`,
			{ stdio: "pipe" },
		);
	} else {
		console.warn("⚠️ Default Chrome profile directory not found, starting with clean profile");
	}
}

// Convert user data dir to Windows path if running Windows executable under WSL
let userDataDir = SCRAPING_DIR;
if (chromeExe.includes("/mnt/c/") || chromeExe.endsWith(".exe")) {
	try {
		userDataDir = execSync(`wslpath -w "${SCRAPING_DIR}"`).toString().trim();
	} catch {}
}

// Start Chrome with flags to force new instance
spawn(
	chromeExe,
	[
		"--remote-debugging-port=9222",
		`--user-data-dir=${userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
	],
	{ detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error("✗ Failed to connect to Chrome");
	process.exit(1);
}

console.log(`✓ Chrome started on :9222${useProfile ? " with your profile" : ""}`);

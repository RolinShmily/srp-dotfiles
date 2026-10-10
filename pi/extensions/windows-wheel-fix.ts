/**
 * windows-wheel-fix.ts — Fix mouse wheel alternateScroll in Zellij / Windows ConPTY
 *
 * Upstream issue: https://github.com/earendil-works/pi/issues/9656
 *
 * Root cause:
 * TuiAltScreen writes the mouse tracking DECSET burst (?1000h ?1002h ?1004h ?1006h)
 * during beforeTerminalStart() BEFORE stdin is switched to raw mode and ENABLE_VIRTUAL_TERMINAL_INPUT
 * is applied. On Windows, ConPTY silently swallows these sequences while in cooked mode,
 * so Zellij never detects that the inner pane requested mouse reporting.
 * Zellij then falls back to xterm alternateScroll, translating mouse wheel ticks into
 * Up/Down arrow keys (which cycles prompt history in Pi's fullscreen editor).
 *
 * Fix:
 * Re-emit the mouse DECSET sequence once raw mode and VT input are established.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const MOUSE_BURST = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";

  // 1. Session start: raw mode is guaranteed active
  pi.on("session_start", async () => {
    process.stdout.write(MOUSE_BURST);
  });

  // 2. Intercept setRawMode to resend burst whenever raw mode is engaged (e.g. TUI start / mode switch)
  const rawStream = process.stdin as NodeJS.ReadStream;
  const originalSetRawMode = rawStream?.setRawMode?.bind(rawStream);
  if (originalSetRawMode) {
    rawStream.setRawMode = function (mode: boolean) {
      const res = originalSetRawMode(mode);
      if (mode) {
        setTimeout(() => {
          process.stdout.write(MOUSE_BURST);
        }, 30);
      }
      return res;
    };
  }
}

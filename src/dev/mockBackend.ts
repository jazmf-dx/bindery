// Dev-only stand-in for the Rust backend, used when the UI is opened in a
// normal browser (`bun run dev`) instead of inside Tauri. Mirrors
// src-tauri/src/commands.rs (via src/lib/api.ts) closely enough for UI work.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

export function installMockBackend() {
  mockWindows("main");
  mockIPC((cmd) => {
    switch (cmd) {
      case "reveal_log":
      case "open_release_page":
        return null;
      case "system_proxy":
        return null;
      default:
        // Plugins (window, log…) the UI calls in passing: nothing to do here.
        if (cmd.startsWith("plugin:")) return null;
        throw new Error(`mock: unknown command ${cmd}`);
    }
  });
}

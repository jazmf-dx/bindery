// Dev-only stand-in for the Rust backend, used when the UI is opened in a
// normal browser (`bun run dev`) instead of inside Tauri. Mirrors
// src-tauri/src/commands.rs (via src/lib/api.ts) closely enough for UI work.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FileRow, Root, View } from "../lib/api";

type MockRoot = { id: number; path: string };

const roots: MockRoot[] = [];
const files: FileRow[] = [];
let nextId = 1;
let scanning = false;

const SAMPLE = [
  "見積書_2026-10.pdf",
  "議事録/2026-11-05 定例.docx",
  "議事録/2026-11-12 定例.docx",
  "売上/月次集計.xlsx",
  "売上/得意先一覧.csv",
  "提案/新サービス案.pptx",
  "メモ/やること.md",
  "README.txt",
];

const nameOf = (p: string) => p.split("/").pop() ?? p;
const extOf = (p: string) => (p.includes(".") ? p.split(".").pop()!.toLowerCase() : "");

function toRoot(r: MockRoot): Root {
  const mine = files.filter((f) => f.rootId === r.id);
  return {
    id: r.id,
    path: r.path,
    name: nameOf(r.path),
    count: mine.filter((f) => !f.missing).length,
    missing: mine.filter((f) => f.missing).length,
  };
}

/** 登録と同じく、裏で少し時間をかけて「読み込む」。 */
function scanLater(root: MockRoot) {
  scanning = true;
  void emit("scan-state", true);
  setTimeout(() => {
    for (const rel of SAMPLE) {
      const path = `${root.path}/${rel}`;
      if (files.some((f) => f.path === path)) continue;
      files.push({
        id: nextId++,
        rootId: root.id,
        path,
        name: nameOf(rel),
        ext: extOf(rel),
        size: 2048 + ((nextId * 7919) % 900_000),
        mtime: Date.now() - nextId * 86_400_000,
        missing: false,
      });
    }
    // 行方不明の見本を 1 件
    const lost = files.find((f) => f.rootId === root.id && f.name === "README.txt");
    if (lost) lost.missing = true;
    scanning = false;
    void emit("scan-state", false);
    void emit("files-changed");
  }, 600);
}

export function installMockBackend() {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "list_roots":
          return roots.map(toRoot).sort((x, y) => x.name.localeCompare(y.name));
        case "add_root": {
          const path = String(a.path);
          if (roots.some((r) => r.path === path)) throw `「${nameOf(path)}」はもう登録してあります`;
          const root = { id: nextId++, path };
          roots.push(root);
          scanLater(root);
          return toRoot(root);
        }
        case "remove_root": {
          const id = Number(a.id);
          roots.splice(roots.findIndex((r) => r.id === id), 1);
          for (let i = files.length - 1; i >= 0; i--) if (files[i].rootId === id) files.splice(i, 1);
          return null;
        }
        case "list_files": {
          const view = a.view as View;
          const rootId = (a.rootId as number | null) ?? null;
          return files
            .filter((f) => f.missing === (view === "missing") && (rootId === null || f.rootId === rootId))
            .sort((x, y) => x.name.localeCompare(y.name, "ja"));
        }
        case "rescan":
          roots.forEach(scanLater);
          return null;
        case "scan_status":
          return scanning;
        case "plugin:dialog|open":
          // フォルダを選ぶダイアログの代わり
          return `/Users/demo/共有/案件${roots.length + 1}`;
        case "plugin:dialog|message":
          window.alert(String(a.message));
          return null;
        case "reveal_log":
        case "open_release_page":
        case "system_proxy":
          return null;
        default:
          // Plugins (window, log…) the UI calls in passing: nothing to do here.
          if (cmd.startsWith("plugin:")) return null;
          throw new Error(`mock: unknown command ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );
}

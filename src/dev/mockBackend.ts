// Dev-only stand-in for the Rust backend, used when the UI is opened in a
// normal browser (`bun run dev`) instead of inside Tauri. Mirrors
// src-tauri/src/commands.rs (via src/lib/api.ts) closely enough for UI work.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FileRow, Place, Root, Tag, VFolder } from "../lib/api";

type MockRoot = { id: number; path: string };

const roots: MockRoot[] = [];
const files: FileRow[] = [];
const tags: Omit<Tag, "count">[] = [];
const vfolders: Omit<VFolder, "count">[] = [];
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
        tags: [],
        folders: [],
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

function setOn(ids: number[], key: "tags" | "folders", id: number, on: boolean) {
  for (const f of files) {
    if (!ids.includes(f.id)) continue;
    const has = f[key].includes(id);
    if (on && !has) f[key] = [...f[key], id];
    if (!on && has) f[key] = f[key].filter((x) => x !== id);
  }
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
        case "root_organized_count":
          return files.filter((f) => f.rootId === Number(a.id) && (f.tags.length || f.folders.length)).length;
        case "list_files": {
          const p = a.place as Place;
          const keep = (f: FileRow) => {
            switch (p.kind) {
              case "all":
                return !f.missing;
              case "unsorted":
                return !f.missing && !f.tags.length && !f.folders.length;
              case "missing":
                return f.missing;
              case "root":
                return !f.missing && f.rootId === p.id;
              case "tag":
                return f.tags.includes(p.id);
              case "folder":
                return f.folders.includes(p.id);
            }
          };
          return files.filter(keep).sort((x, y) => x.name.localeCompare(y.name, "ja")).map((f) => ({ ...f }));
        }
        case "open_files":
        case "reveal_file":
        case "quick_look":
          console.info(`mock: ${cmd}`, a);
          return null;
        case "list_tags":
          return tags
            .map((t) => ({ ...t, count: files.filter((f) => f.tags.includes(t.id)).length }))
            .sort((x, y) => x.name.localeCompare(y.name, "ja"));
        case "add_tag":
        case "create_tag": {
          const name = String(a.name).trim();
          let tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
          if (!tag) tags.push((tag = { id: nextId++, name }));
          if (cmd === "add_tag") setOn((a.ids as number[]) ?? [], "tags", tag.id, true);
          return tag.id;
        }
        case "set_tag":
          setOn(a.ids as number[], "tags", Number(a.tagId), Boolean(a.on));
          return null;
        case "rename_tag": {
          const tag = tags.find((t) => t.id === Number(a.id));
          if (tag) tag.name = String(a.name);
          return null;
        }
        case "delete_tag":
          tags.splice(tags.findIndex((t) => t.id === Number(a.id)), 1);
          for (const f of files) f.tags = f.tags.filter((t) => t !== Number(a.id));
          return null;
        case "list_vfolders":
          return vfolders
            .map((v) => ({ ...v, count: files.filter((f) => f.folders.includes(v.id)).length }))
            .sort((x, y) => x.name.localeCompare(y.name, "ja"));
        case "create_vfolder": {
          const v = { id: nextId++, name: String(a.name), parentId: (a.parentId as number | null) ?? null };
          vfolders.push(v);
          return v.id;
        }
        case "rename_vfolder": {
          const v = vfolders.find((x) => x.id === Number(a.id));
          if (v) v.name = String(a.name);
          return null;
        }
        case "move_vfolder": {
          const v = vfolders.find((x) => x.id === Number(a.id));
          if (v) v.parentId = (a.parentId as number | null) ?? null;
          return null;
        }
        case "delete_vfolder": {
          // 下の仮想フォルダも消える
          const gone = new Set([Number(a.id)]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const v of vfolders) if (v.parentId !== null && gone.has(v.parentId) && !gone.has(v.id)) (gone.add(v.id), (grew = true));
          }
          for (let i = vfolders.length - 1; i >= 0; i--) if (gone.has(vfolders[i].id)) vfolders.splice(i, 1);
          for (const f of files) f.folders = f.folders.filter((id) => !gone.has(id));
          return null;
        }
        case "set_vfolder":
          setOn(a.ids as number[], "folders", Number(a.vfolderId), Boolean(a.on));
          return null;
        case "rescan":
          roots.forEach(scanLater);
          return null;
        case "scan_status":
          return scanning;
        case "plugin:dialog|open":
          // フォルダを選ぶダイアログの代わり
          return `/Users/demo/共有/案件${roots.length + 1}`;
        case "plugin:dialog|message": {
          // 確かめるダイアログ（ask）は［OK］［キャンセル］の名前付きで届く
          const b = a.buttons as { OkCancelCustom?: [string, string] } | undefined;
          if (b?.OkCancelCustom) return window.confirm(String(a.message)) ? b.OkCancelCustom[0] : b.OkCancelCustom[1];
          window.alert(String(a.message));
          return null;
        }
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

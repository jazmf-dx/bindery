// Dev-only stand-in for the Rust backend, used when the UI is opened in a
// normal browser (`bun run dev`) instead of inside Tauri. Mirrors
// src-tauri/src/commands.rs (via src/lib/api.ts) closely enough for UI work.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FileRow, Place, Root, Tag, VFolder } from "../lib/api";

type MockRoot = { id: number; path: string; recursive: boolean; scanned: boolean };

/** 「最近の変更」に出す日数（src-tauri/src/db.rs `RECENT_DAYS`）。 */
const RECENT_MS = 7 * 86_400_000;
const isRecent = (f: FileRow) => !f.missing && f.changedAt !== null && f.changedAt >= Date.now() - RECENT_MS;

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
  "メモ/2025/去年のメモ.md",
  "README.txt",
];
/** 2 回目からの読み込みで「増えた」ことにするもの（最近の変更の見本）。 */
const SAMPLE_LATER = ["見積書_2026-11.pdf"];

const nameOf = (p: string) => p.split("/").pop() ?? p;
const extOf = (p: string) => (p.includes(".") ? p.split(".").pop()!.toLowerCase() : "");
/** 登録フォルダから見た、ファイルのあるフォルダ（直下は空）。 */
const dirOf = (f: FileRow) => {
  const root = roots.find((r) => r.id === f.rootId);
  const rel = root ? f.path.slice(root.path.length + 1) : f.path;
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
};

function toRoot(r: MockRoot): Root {
  const mine = files.filter((f) => f.rootId === r.id);
  const counts = new Map<string, number>();
  for (const f of mine) {
    const d = dirOf(f);
    if (f.missing || !d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    for (let at = d; at.includes("/"); ) {
      at = at.slice(0, at.lastIndexOf("/"));
      if (!counts.has(at)) counts.set(at, 0);
    }
  }
  return {
    id: r.id,
    path: r.path,
    name: nameOf(r.path),
    count: mine.filter((f) => !f.missing).length,
    missing: mine.filter((f) => f.missing).length,
    recent: mine.filter(isRecent).length,
    recursive: r.recursive,
    dirs: [...counts].map(([path, count]) => ({ path, count })).sort((x, y) => x.path.localeCompare(y.path, "ja")),
  };
}

/** 登録と同じく、裏で少し時間をかけて「読み込む」。 */
function scanLater(root: MockRoot) {
  scanning = true;
  void emit("scan-state", true);
  setTimeout(() => {
    for (const rel of root.scanned ? [...SAMPLE, ...SAMPLE_LATER] : SAMPLE) {
      if (!root.recursive && rel.includes("/")) continue;
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
        note: "",
        // 登録して最初に読んだものは「増えた」に入れない
        changedAt: root.scanned ? Date.now() : null,
        change: root.scanned ? "new" : null,
      });
    }
    // 2 回目からは、中身が変わったことにする見本を 1 件
    const edited = root.scanned ? files.find((f) => f.rootId === root.id && f.name === "月次集計.xlsx") : undefined;
    if (edited) Object.assign(edited, { mtime: Date.now(), changedAt: Date.now(), change: "updated" });
    root.scanned = true;
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
          const root = { id: nextId++, path, recursive: Boolean(a.recursive), scanned: false };
          roots.push(root);
          scanLater(root);
          return toRoot(root);
        }
        case "inspect_paths":
          // 拡張子の無いものをフォルダとみなす
          return (a.paths as string[]).map((path) => ({ path, isDir: !nameOf(path).includes("."), hasSubdirs: !nameOf(path).includes(".") }));
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
              case "recent":
                return isRecent(f);
              case "root":
                return !f.missing && f.rootId === p.id && dirOf(f) === p.dir;
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
        case "set_note": {
          const f = files.find((x) => x.id === Number(a.id));
          if (f) f.note = String(a.note).trim() ? String(a.note) : "";
          return null;
        }
        case "relink_file": {
          const lost = files.find((x) => x.id === Number(a.id));
          if (!lost?.missing) throw "行方不明のファイルではありません";
          const path = String(a.path);
          const root = roots.find((r) => path.startsWith(`${r.path}/`));
          if (!root) throw "登録フォルダの中のファイルを選んでください";
          // そのファイルの行がもうあれば、付けたものを引き継いでまとめる
          const i = files.findIndex((x) => x.path === path && x.id !== lost.id);
          if (i >= 0) {
            const dup = files.splice(i, 1)[0];
            lost.tags = [...new Set([...lost.tags, ...dup.tags])];
            lost.folders = [...new Set([...lost.folders, ...dup.folders])];
            if (!lost.note) lost.note = dup.note;
          }
          Object.assign(lost, { rootId: root.id, path, name: nameOf(path), ext: extOf(path), missing: false });
          return null;
        }
        case "forget_files": {
          const ids = new Set(a.ids as number[]);
          const before = files.length;
          for (let i = files.length - 1; i >= 0; i--) if (files[i].missing && ids.has(files[i].id)) files.splice(i, 1);
          return before - files.length;
        }
        case "rescan":
          roots.forEach(scanLater);
          return null;
        case "scan_status":
          return scanning;
        case "plugin:dialog|open": {
          // ファイルを選ぶダイアログ（つなぎ直す）の代わり：最初の登録フォルダの中へ移したことにする
          const o = a.options as { directory?: boolean } | undefined;
          if (!o?.directory) return roots.length ? `${roots[0].path}/移した/README.txt` : null;
          // フォルダを選ぶダイアログの代わり
          return `/Users/demo/共有/案件${roots.length + 1}`;
        }
        case "plugin:dialog|message": {
          // 確かめるダイアログ（ask）は［OK］［キャンセル］の名前付きで届く
          const b = a.buttons as { OkCancelCustom?: [string, string]; YesNoCancelCustom?: [string, string, string] } | undefined;
          if (b?.OkCancelCustom) return window.confirm(String(a.message)) ? b.OkCancelCustom[0] : b.OkCancelCustom[1];
          // 3 つのボタン：OK で 1 つめ、キャンセルで 2 つめ（やめるは選べない）
          if (b?.YesNoCancelCustom) return window.confirm(`${String(a.message)}\n\nOK：${b.YesNoCancelCustom[0]}／キャンセル：${b.YesNoCancelCustom[1]}`) ? b.YesNoCancelCustom[0] : b.YesNoCancelCustom[1];
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

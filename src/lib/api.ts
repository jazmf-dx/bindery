/**
 * Rust のコマンド（src-tauri/src/commands.rs）を呼ぶラッパ。画面からは必ずここを通す。
 * コマンドを足したら、ブラウザ用のモック（src/dev/mockBackend.ts）も同じ PR で直す。
 */
import { invoke } from "@tauri-apps/api/core";

/** 登録フォルダ（src-tauri/src/db.rs `Root`）。 */
export type Root = {
  id: number;
  path: string;
  /** 表示用の名前（パスの最後）。 */
  name: string;
  /** 中のファイルの数（行方不明を含まない）。 */
  count: number;
  missing: number;
};

/** ファイルの記録（src-tauri/src/db.rs `FileRow`）。 */
export type FileRow = {
  id: number;
  rootId: number;
  path: string;
  name: string;
  /** 小文字の拡張子。 */
  ext: string;
  size: number;
  /** 更新日時（ミリ秒）。 */
  mtime: number;
  missing: boolean;
  /** 付いているタグの id。 */
  tags: number[];
  /** 入っている仮想フォルダの id。 */
  folders: number[];
};

/** 一覧に出すもの。サイドバーの項目（src-tauri/src/db.rs `Place`）。 */
export type Place =
  | { kind: "all" }
  | { kind: "unsorted" }
  | { kind: "missing" }
  | { kind: "root"; id: number }
  | { kind: "tag"; id: number }
  | { kind: "folder"; id: number };

export type Tag = { id: number; name: string; count: number };

/** 仮想フォルダ。`count` は直接入っているファイルの数。 */
export type VFolder = { id: number; name: string; parentId: number | null; count: number };

/** Rust から届く知らせ（src-tauri/src/library.rs）。 */
export const FILES_CHANGED = "files-changed";
export const SCAN_STATE = "scan-state";

export const api = {
  listRoots: () => invoke<Root[]>("list_roots"),
  /** フォルダを登録して、裏で読み込みを始める。登録できないフォルダはエラーの文で断る。 */
  addRoot: (path: string) => invoke<Root>("add_root", { path }),
  /** 登録を外す。アプリのデータの行だけを消し、元のファイルには触らない。 */
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),
  /** タグか仮想フォルダが付いたファイルの数（登録を外す前の確認用）。 */
  rootOrganizedCount: (id: number) => invoke<number>("root_organized_count", { id }),
  listFiles: (place: Place) => invoke<FileRow[]>("list_files", { place }),
  /** すべての登録フォルダを読み直す（照合）。 */
  rescan: () => invoke<void>("rescan"),
  scanStatus: () => invoke<boolean>("scan_status"),

  /** 既定のアプリで開く。 */
  openFiles: (ids: number[]) => invoke<void>("open_files", { ids }),
  /** Finder / エクスプローラーで表示する。 */
  revealFile: (id: number) => invoke<void>("reveal_file", { id }),
  /** Quick Look。開いていれば閉じる（Windows は既定のアプリで開く）。 */
  quickLook: (ids: number[]) => invoke<void>("quick_look", { ids }),

  listTags: () => invoke<Tag[]>("list_tags"),
  /** その名前のタグを付ける（無ければ作る）。付けたタグの id を返す。 */
  addTag: (ids: number[], name: string) => invoke<number>("add_tag", { ids, name }),
  setTag: (ids: number[], tagId: number, on: boolean) => invoke<void>("set_tag", { ids, tagId, on }),
  createTag: (name: string) => invoke<number>("create_tag", { name }),
  /** 同じ名前のタグがあれば、そちらにまとまる。 */
  renameTag: (id: number, name: string) => invoke<void>("rename_tag", { id, name }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),

  listVFolders: () => invoke<VFolder[]>("list_vfolders"),
  createVFolder: (name: string, parentId: number | null) => invoke<number>("create_vfolder", { name, parentId }),
  renameVFolder: (id: number, name: string) => invoke<void>("rename_vfolder", { id, name }),
  /** 下の仮想フォルダも消える。中のファイルはそのまま。 */
  deleteVFolder: (id: number) => invoke<void>("delete_vfolder", { id }),
  moveVFolder: (id: number, parentId: number | null) => invoke<void>("move_vfolder", { id, parentId }),
  setVFolder: (ids: number[], vfolderId: number, on: boolean) => invoke<void>("set_vfolder", { ids, vfolderId, on }),

  /** ログのファイルを Finder / エクスプローラーで表示する。 */
  revealLog: () => invoke<void>("reveal_log"),
  /** 更新の配信先に OS が使うプロキシ（PAC を含む）。null は直接つなぐ。 */
  systemProxy: () => invoke<string | null>("system_proxy"),
  /** その版のリリースのページをブラウザで開く。 */
  openReleasePage: (version: string) => invoke<void>("open_release_page", { version }),
};

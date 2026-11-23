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
};

/** 一覧に出すもの（src-tauri/src/db.rs `View`）。 */
export type View = "all" | "unsorted" | "missing";

/** Rust から届く知らせ（src-tauri/src/library.rs）。 */
export const FILES_CHANGED = "files-changed";
export const SCAN_STATE = "scan-state";

export const api = {
  listRoots: () => invoke<Root[]>("list_roots"),
  /** フォルダを登録して、裏で読み込みを始める。登録できないフォルダはエラーの文で断る。 */
  addRoot: (path: string) => invoke<Root>("add_root", { path }),
  /** 登録を外す。アプリのデータの行だけを消し、元のファイルには触らない。 */
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),
  listFiles: (view: View, rootId: number | null) => invoke<FileRow[]>("list_files", { view, rootId }),
  /** すべての登録フォルダを読み直す（照合）。 */
  rescan: () => invoke<void>("rescan"),
  scanStatus: () => invoke<boolean>("scan_status"),

  /** ログのファイルを Finder / エクスプローラーで表示する。 */
  revealLog: () => invoke<void>("reveal_log"),
  /** 更新の配信先に OS が使うプロキシ（PAC を含む）。null は直接つなぐ。 */
  systemProxy: () => invoke<string | null>("system_proxy"),
  /** その版のリリースのページをブラウザで開く。 */
  openReleasePage: (version: string) => invoke<void>("open_release_page", { version }),
};

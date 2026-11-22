/**
 * Rust のコマンド（src-tauri/src/commands.rs）を呼ぶラッパ。画面からは必ずここを通す。
 * コマンドを足したら、ブラウザ用のモック（src/dev/mockBackend.ts）も同じ PR で直す。
 */
import { invoke } from "@tauri-apps/api/core";

export const api = {
  /** ログのファイルを Finder / エクスプローラーで表示する。 */
  revealLog: () => invoke<void>("reveal_log"),
  /** 更新の配信先に OS が使うプロキシ（PAC を含む）。null は直接つなぐ。 */
  systemProxy: () => invoke<string | null>("system_proxy"),
  /** その版のリリースのページをブラウザで開く。 */
  openReleasePage: (version: string) => invoke<void>("open_release_page", { version }),
};

# Project Context

AI と人が実装前に確認する **現在の前提**。機能要件、ロードマップ、画面仕様は `docs/` に置き、ここには書かない。
変更したら日付を更新する。変更の理由を将来説明する価値がある場合だけ、別の ADR を残す。

**更新日**：2026-11-26

| 項目 | 現在の前提 |
|---|---|
| ツールの種類 | ウィンドウアプリ |
| UI の実装 | React + zustand + Tailwind 4 |
| データの置き場 | `app_data_dir()` の `bindery.db`（SQLite）1 つ。構造は docs/ARCHITECTURE.md。元のファイルは参照するだけで、ライブラリへ取り込まない（docs/CONCEPT.md） |
| 外との接続 | なし（ブラウザ拡張・MCP・待ち受けポートは持たない） |
| 配布の形 | 単独リポジトリ（tag `v*`、feed `https://github.com/jazmf-dx/bindery/releases/latest/download/latest.json`） |
| 識別子 | `com.local.bindery`、`productName` は `Bindery`（一度配布したら変えない） |
| updater の鍵 | **Bindery の鍵**（2026-11-26 に作った）。公開鍵は `tauri.conf.json`、秘密鍵とパスワードはリポジトリの Secrets（`TAURI_SIGNING_PRIVATE_KEY`・`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）と、作った人の手元の控え。秘密鍵を無くすと、入っている版へ更新を届けられなくなる（desktop-platform playbook/updater-key.md）。0.1.0 は一時的な鍵で、更新ファイルを作らずに出した |
| アイコン | `app-icon.svg`（色の束：3 色の書類を白い背でまとめる）。`bunx tauri icon app-icon.svg` で `src-tauri/icons/` を作る |
| desktop-base | 未採用（まだ無い）。stockroom の `eadf712` から土台を写した（desktop-platform playbook/new-tool.md「desktop-base がまだ無いとき」） |

## stockroom から写したときに変えたところ

- `src/lib/update.ts`：トースト・設定画面とのやりとりを外し、ダイアログだけにした（まだトーストも設定画面も無い）。自動の確認は常にする（設定ができたら切れるようにする）
- `src-tauri/src/commands.rs`：土台のコマンド（ログを表示・プロキシ・リリースのページ）だけ。タグの接頭辞（社内版の `corp-`）は持たない
- 機能を絞ったビルド（stockroom の `limits`）は持たない
- CSP：`asset:` を外した（まだファイルを画面に出さない）。プレビューを作るときに、元のファイルをどう画面に渡すかと一緒に決める（人の判断が要る）
- メニューバー（`src/lib/menuBar.ts`）は stockroom のものを小さくした。項目の状態（押せない・チェック）は持たない。設定画面はまだ無い

## 足した依存

どれも stockroom が同じ版で使っているもの：`rusqlite`（bundled）・`walkdir`・`sha2`・`hex`・`tempfile`（テストだけ）、`zustand`・`@tanstack/react-virtual`。`windows` クレートに `Win32_Storage_FileSystem`（ファイル ID）を足した。

## 該当しない Standard

- Optional「ローカル受付」：該当なし（外との接続が無い）
- Optional「複数ツール同居」「トレイ常駐」：該当なし

## 逸脱

- **0.1.0 だけアプリ内アップデートを使わなかった**（desktop-platform Distribution §4「配布するツールは必ず updater を入れる」から。人の判断、2026-11-23）。署名鍵がまだ無かったため。
  0.2.0 で Bindery の鍵を作り、`createUpdaterArtifacts` と `UPDATES` を `true` に戻した（2026-11-26）。0.1.0 を入れた端末は、0.2.0 を 1 回だけ手で入れ直す
- 最初のコミットだけ、空のリポジトリだったので main に直接 push した（PR の土台が無かったため。人の判断）

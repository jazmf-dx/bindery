# 設計の境界

整理の仕組みを作りながら、ここに足していく。何を作るかは [CONCEPT.md](CONCEPT.md)。

## 守ること

- **元のファイルは読むだけ。** 書き換えない・動かさない・消さない。アプリのデータ（タグ・仮想フォルダ・メモ・登録フォルダ・照合用の情報）は `app_data_dir()` の SQLite に置き、元のファイルにも共有ドライブにも書かない
- **外へ通信しない。** 例外はアプリ内アップデートだけ（`plugins.updater.endpoints`）

## 層

| 層 | 場所 | 役目 |
|---|---|---|
| 画面 | `src/` | React。部品は `src/components/`（サイドバー・一覧・詳細パネル・ドラッグ）。状態は `src/store.ts`（データベースの写し。`files-changed` と自分の変更のあとに読み直す）。操作は `src/lib/commands.ts` の表から |
| 呼び出し | `src/lib/api.ts` | Rust のコマンドのラッパ。ブラウザでは `src/dev/mockBackend.ts` が代わりに答える |
| コマンド | `src-tauri/src/commands.rs` | 画面から呼ばれる入口 |
| データ | `src-tauri/src/db.rs` | `app_data_dir()/bindery.db`（SQLite）。表は `roots`（登録フォルダ）・`files`（見つけたファイル）・`tags` と `file_tags`・`vfolders`（`parent_id` で入れ子）と `vfolder_files`。版は `PRAGMA user_version` と `SCHEMA` の手順 |
| 照合 | `src-tauri/src/scan.rs` | フォルダを読む（`walk`）・記録を合わせる（`apply`）・ハッシュでつなぎ直す（`record_hash`） |
| 裏の仕事 | `src-tauri/src/library.rs` | 読み込みとハッシュの計算を裏のスレッドで。変わったら `files-changed`、読み込みの始まりと終わりに `scan-state` を画面へ送る |
| Quick Look | `src-tauri/src/quicklook.rs` | macOS は `qlmanage -p`、Windows は既定のアプリ |
| 土台 | `src-tauri/src/lib.rs`、`proxy.rs` | プラグインの配線・ログ・ウィンドウ、更新のためのプロキシ |

## 時間のかかる仕事

フォルダを読む・ハッシュを計算するのは、データベースのロックを持たずに行い、結果を書くときだけロックする。
共有ドライブで時間がかかっても、そのあいだ一覧の表示を止めないため。ハッシュの計算は読み込みが始まったら譲る。

## ドラッグ

一覧の行のドラッグは、ブラウザのドラッグ＆ドロップを使わず、マウスの動きで作っている（`src/components/FileList.tsx` の `startDrag`、`DragLayer.tsx`）。
Tauri はウィンドウへのファイルのドロップを受ける設定のため、Windows ではページの中のドラッグ＆ドロップが届かない。
落とし先はサイドバーの行の `data-drop="tag:ID"` / `"folder:ID"`。

## メニューとキー

操作は `src/lib/commands.ts` の表に 1 回だけ書き、メニューバー（`src/lib/menuBar.ts`）・キー・画面のボタンはそこから使う。
⌘ / Ctrl の組み合わせはメニューの accelerator が受け、ページは受けない（2 回動かないように）。
スペース・Enter・矢印・Esc は入力欄の文字にも使うので、ページが受ける。入力欄にいるときは、表で `inFields` にしたものだけが効く。

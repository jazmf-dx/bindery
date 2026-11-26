# 設計の境界

整理の仕組みを作りながら、ここに足していく。何を作るかは [CONCEPT.md](CONCEPT.md)。

## 守ること

- **元のファイルは読むだけ。** 書き換えない・動かさない・消さない。アプリのデータ（タグ・仮想フォルダ・メモ・登録フォルダ・照合用の情報）は `app_data_dir()` の SQLite に置き、元のファイルにも共有ドライブにも書かない
- **外へ通信しない。** 例外はアプリ内アップデートだけ（`plugins.updater.endpoints`）

## 層

| 層 | 場所 | 役目 |
|---|---|---|
| 画面 | `src/` | React。部品は `src/components/`（サイドバー・ツールバー・条件の行・一覧（リスト `FileList.tsx`・グリッド `FileGrid.tsx`）・詳細パネル・ドラッグ）。状態は `src/store.ts`（データベースの写し。`files-changed` と自分の変更のあとに読み直す）。絞り込みと並べ替えは画面の中だけで行う（`src/lib/view.ts`。読んだ行 `allFiles` から一覧の行 `files` を作る。条件のメニューの件数も同じ）。並べ替え・一覧の形・列・パネルの開け閉めと幅は、この端末の localStorage に覚える（`view.ts` の `loadSort`・`loadPrefs`）。操作は `src/lib/commands.ts` の表から |
| 呼び出し | `src/lib/api.ts` | Rust のコマンドのラッパ。ブラウザでは `src/dev/mockBackend.ts` が代わりに答える |
| コマンド | `src-tauri/src/commands.rs` | 画面から呼ばれる入口 |
| データ | `src-tauri/src/db.rs` | `app_data_dir()/bindery.db`（SQLite）。表は `roots`（登録フォルダ。`recursive` でサブフォルダまで読むか、`scanned` で登録してから 1 度読んだか）・`files`（見つけたファイル。`dir` は登録フォルダから見た中のフォルダ、`note` はメモ、`changed_at`・`change_kind` はアプリが変化に気付いた日時と中身）・`tags` と `file_tags`・`vfolders`（`parent_id` で入れ子）と `vfolder_files`。版は `PRAGMA user_version` と `SCHEMA` の手順 |
| 照合 | `src-tauri/src/scan.rs` | フォルダを読む（`walk`）・記録を合わせる（`apply`。変化に気付いた日時もここで書く）・ハッシュでつなぎ直す（`record_hash`）・手でつなぎ直す（`relink`） |
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
仮想フォルダの行も同じ作りでドラッグする（`Sidebar.tsx` の `startFolderDrag`）。落とし先は `"folder:ID"` と、一番上へ移す `"folder:top"`（「仮想フォルダ」の見出し）。

Finder / エクスプローラーからウィンドウへ落としたものは、Tauri の `onDragDropEvent` で受ける（`src/components/DropZone.tsx`）。
フォルダか・サブフォルダがあるかを `inspect_paths` で確かめてから、`store.ts` の `addRoots` で登録する（［フォルダを登録…］も同じ道を通る）。
ファイルだけを落としたときは、入っているフォルダを直下だけで登録し、読み込みが終わって一覧に出たらそのファイルを選ぶ（`addFilesByFolder`）。

## メニューとキー

操作は `src/lib/commands.ts` の表に 1 回だけ書き、メニューバー（`src/lib/menuBar.ts`）・キー・画面のボタンはそこから使う。
⌘ / Ctrl の組み合わせはメニューの accelerator が受け、ページは受けない（2 回動かないように）。
右クリックのメニューも OS のメニュー（`src/lib/contextMenu.ts`）。項目は表の操作（`cmd`）か store の操作から組み立て、キーは付けない（メニューバーと 2 回動かないように）。
スペース・Enter・矢印・Esc は入力欄の文字にも使うので、ページが受ける。入力欄にいるときは、表で `inFields` にしたものだけが効く。

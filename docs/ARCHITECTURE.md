# 設計の境界

まだ土台だけ。整理の仕組みを作るときに、ここに足していく。何を作るかは [CONCEPT.md](CONCEPT.md)。

## 守ること

- **元のファイルは読むだけ。** 書き換えない・動かさない・消さない。アプリのデータ（タグ・仮想フォルダ・メモ・登録フォルダ・照合用の情報）は `app_data_dir()` の SQLite に置き、元のファイルにも共有ドライブにも書かない
- **外へ通信しない。** 例外はアプリ内アップデートだけ（`plugins.updater.endpoints`）

## 層

| 層 | 場所 | 役目 |
|---|---|---|
| 画面 | `src/` | React。操作は `src/lib/commands.ts` の表から |
| 呼び出し | `src/lib/api.ts` | Rust のコマンドのラッパ。ブラウザでは `src/dev/mockBackend.ts` が代わりに答える |
| コマンド | `src-tauri/src/commands.rs` | 画面から呼ばれる入口 |
| 土台 | `src-tauri/src/lib.rs`、`proxy.rs` | プラグインの配線・ログ・ウィンドウ、更新のためのプロキシ |

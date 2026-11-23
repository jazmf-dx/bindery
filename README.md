# Bindery

PDF・オフィス文書・テキストを、**元の場所に置いたまま** タグ・仮想フォルダ・メモで整理するアプリ（Tauri 2 / macOS・Windows）。
ファイルを取り込まず、書き換えず、動かさない。散らばったファイルを、置き場所を変えずにまとめて見つけられるようにする。

**まだ作り始めたところ。** 何を作るかは [docs/CONCEPT.md](docs/CONCEPT.md)。

## 機能

- フォルダを登録すると、中（下の階層まで）の PDF・オフィス文書・テキストが一覧に並ぶ。ファイルは元の場所のままで、動かさず書き換えない
- 起動時と［読み直す］で照合し、移動・改名したファイルを探し直す。見つからないものは「行方不明」に出る
- 登録を外す（アプリのデータから消すだけで、元のファイルには触らない）
- タグと仮想フォルダで整理する（入れ子、1 つのファイルを複数に）。詳細パネルか、一覧の行をサイドバーへドラッグして付ける。どちらも付いていないものは「未整理」に出る
- スペースで Quick Look（Windows は既定のアプリで開く）。開く・場所を表示・パスをコピー

予定は [docs/CONCEPT.md](docs/CONCEPT.md)。

## キーボード

| キー | 操作 |
|---|---|
| スペース | Quick Look |
| Enter / ⌘↓ / Ctrl+↓、ダブルクリック | 開く |
| ⌘⇧R / Ctrl+Shift+R | Finder / エクスプローラーで表示 |
| ⌘⌥C / Ctrl+Alt+C | パスをコピー |
| ↑ ↓（Shift で範囲） | 前・次を選ぶ |
| ⌘A / Ctrl+A | すべて選ぶ |
| Esc | 選ぶのをやめる |
| ⌘⇧N / Ctrl+Shift+N | 新しい仮想フォルダ（仮想フォルダを開いていればその中に） |
| ⌘O / Ctrl+O | フォルダを登録 |
| ⌘R / Ctrl+R | 読み直す |
| ⌘⇧L / Ctrl+Shift+L | 外観を切り替える |

## インストール

まだ配布していない。配布を始めたら、初回だけ出る警告の手順をここに書く（desktop-platform Distribution §3）。

## 開発

```bash
bun install
bun run tauri dev      # アプリを起動
bun run dev            # ブラウザで UI だけ（モック）
bun run test           # cargo test + tsc --noEmit
```

Linux で `cargo test` を通すには `libwebkit2gtk-4.1-dev` と `librsvg2-dev` が要る。

開発の基準は [desktop-platform](https://github.com/jazmf-dx/desktop-platform) の `ai/ONBOARDING.md`。前提は [decisions/project-context.md](decisions/project-context.md)。

## 構成

```text
src/                 画面（React + Tailwind 4）
  lib/commands.ts    操作の表
  lib/api.ts         Rust のコマンドのラッパ
  dev/mockBackend.ts ブラウザで動かすときのモック
src-tauri/           Rust（Tauri 2）
decisions/           前提（project-context.md）
docs/                何を作るか（CONCEPT.md）、設計の境界（ARCHITECTURE.md）
```

## ドキュメント

- [docs/CONCEPT.md](docs/CONCEPT.md)：何を作るか・決めたこと・詰めること
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：設計の境界

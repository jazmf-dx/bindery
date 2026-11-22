# Bindery

PDF・オフィス文書・テキストを、**元の場所に置いたまま** タグ・仮想フォルダ・メモで整理するアプリ（Tauri 2 / macOS・Windows）。
ファイルを取り込まず、書き換えず、動かさない。散らばったファイルを、置き場所を変えずにまとめて見つけられるようにする。

**まだ作り始めたところ**で、画面の枠しかない。何を作るかは [docs/CONCEPT.md](docs/CONCEPT.md)。

## 機能

まだ無い（予定は [docs/CONCEPT.md](docs/CONCEPT.md) の「決めたこと」）。

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

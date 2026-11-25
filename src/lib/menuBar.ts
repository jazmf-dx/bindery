/**
 * メニューバー（macOS は画面上部、Windows はウィンドウのメニュー）。操作の表（commands.ts）から作る。
 * stockroom の src/lib/menuBar.ts を小さくしたもの。
 *
 * キー：⌘ / Ctrl の組み合わせは項目の accelerator にする（メニューが受ける）。
 * スペース・Enter・矢印・Esc は入力欄の文字にも使うので、ページが受ける（メニューには出すだけ：
 * Windows は名前のあとにタブで右寄せ。macOS は出さない）。
 * macOS では、入力欄のコピー・ペーストなどは「編集」メニューの項目が無いと効かないので、標準の項目を置く。
 */
import { isTauri } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { command, isMac, keyLabel, runCommand, setMenuTakesMod } from "./commands";
import { warn } from "./log";
import { UPDATES } from "./update";

const APP = "Bindery";

/** "Mod+Shift+N" → "CmdOrCtrl+Shift+N"。 */
const accelerator = (key: string) => key.replace("Mod+", "CmdOrCtrl+");

function item(id: string): Promise<MenuItem> {
  const c = command(id);
  const combo = c.keys?.find((k) => k.includes("Mod+"));
  const shown = !combo && !isMac && c.keys?.length ? `${c.label}\t${keyLabel(id)}` : c.label;
  return MenuItem.new({ text: shown, accelerator: combo ? accelerator(combo) : undefined, action: () => runCommand(id) });
}

const sep = () => PredefinedMenuItem.new({ item: "Separator" });

async function submenu(text: string, items: Promise<MenuItem | PredefinedMenuItem | Submenu>[]) {
  return Submenu.new({ text, items: await Promise.all(items) });
}

async function build(): Promise<Menu> {
  const about = () => PredefinedMenuItem.new({ item: { About: null }, text: `${APP} について` });
  const menus = [
    ...(isMac
      ? [
          submenu(APP, [
            about(),
            ...(UPDATES ? [item("help.update")] : []),
            sep(),
            PredefinedMenuItem.new({ item: "Services", text: "サービス" }),
            sep(),
            PredefinedMenuItem.new({ item: "Hide", text: `${APP} を隠す` }),
            PredefinedMenuItem.new({ item: "HideOthers", text: "ほかを隠す" }),
            PredefinedMenuItem.new({ item: "ShowAll", text: "すべてを表示" }),
            sep(),
            PredefinedMenuItem.new({ item: "Quit", text: `${APP} を終了` }),
          ]),
        ]
      : []),
    submenu("ファイル", [
      item("folder.add"),
      item("folder.rescan"),
      item("folder.remove"),
      sep(),
      item("vfolder.new"),
      item("tag.new"),
      ...(isMac ? [] : [sep(), PredefinedMenuItem.new({ item: "Quit", text: "終了" })]),
    ]),
    submenu("編集", [
      PredefinedMenuItem.new({ item: "Undo", text: "取り消す" }),
      PredefinedMenuItem.new({ item: "Redo", text: "やり直す" }),
      sep(),
      PredefinedMenuItem.new({ item: "Cut", text: "カット" }),
      PredefinedMenuItem.new({ item: "Copy", text: "コピー" }),
      PredefinedMenuItem.new({ item: "Paste", text: "ペースト" }),
      // 入力欄では文字を、一覧ではファイルを全部選ぶ
      item("select.all"),
      item("select.none"),
      sep(),
      item("find"),
    ]),
    submenu("ファイル操作", [
      item("file.open"),
      item("file.quickLook"),
      sep(),
      item("file.reveal"),
      item("file.copyPath"),
      sep(),
      item("file.relink"),
      item("file.forget"),
    ]),
    submenu("表示", [item("view.appearance")]),
    ...(isMac
      ? [
          submenu("ウィンドウ", [
            PredefinedMenuItem.new({ item: "Minimize", text: "しまう" }),
            PredefinedMenuItem.new({ item: "Maximize", text: "拡大／縮小" }),
            sep(),
            PredefinedMenuItem.new({ item: "Fullscreen", text: "フルスクリーン" }),
            sep(),
            PredefinedMenuItem.new({ item: "CloseWindow", text: "閉じる" }),
          ]),
        ]
      : []),
    submenu("ヘルプ", [item("help.log"), ...(isMac ? [] : [...(UPDATES ? [item("help.update")] : []), sep(), about()])]),
  ];
  return Menu.new({ items: await Promise.all(menus) });
}

/** 起動時に 1 回。ブラウザ（モック）では作らない。 */
export async function setUpMenuBar() {
  if (!isTauri()) return;
  try {
    const menu = await build();
    await menu.setAsAppMenu();
    setMenuTakesMod(true);
  } catch (e) {
    // メニューが作れなくても、キーはページが受ける
    warn("menu bar", e);
  }
}

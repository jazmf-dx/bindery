/**
 * 右クリックのメニュー（OS のメニュー。メニューバーと同じ Tauri の部品）。
 * 中身は呼ぶ側が操作の表（commands.ts）や store の操作から組み立てる。
 * ブラウザ（モック）では出さない（ブラウザのメニューのまま）。
 */
import { isTauri } from "@tauri-apps/api/core";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { command, runCommand } from "./commands";
import { warn } from "./log";

export type Entry =
  | { label: string; run: () => void; enabled?: boolean }
  | { label: string; items: Entry[]; enabled?: boolean }
  | "-";

/** 操作の表の項目（名前は表のもの）。 */
export const cmd = (id: string, enabled = true): Entry => ({ label: command(id).label, run: () => runCommand(id), enabled });

async function build(entries: Entry[]): Promise<(MenuItem | PredefinedMenuItem | Submenu)[]> {
  // 区切りが続く・端にあるものは落とす（条件で項目が消えたとき）
  const tidy = entries.filter((e, i, a) => e !== "-" || (i > 0 && i < a.length - 1 && a[i - 1] !== "-"));
  return Promise.all(
    tidy.map(async (e) => {
      if (e === "-") return PredefinedMenuItem.new({ item: "Separator" });
      if ("items" in e) {
        const items = await build(e.items);
        return Submenu.new({ text: e.label, items, enabled: (e.enabled ?? true) && items.length > 0 });
      }
      return MenuItem.new({ text: e.label, enabled: e.enabled ?? true, action: e.run });
    }),
  );
}

/** `contextmenu` の受け手。アプリの中では OS のメニューを出す。 */
export function openMenu(e: { preventDefault: () => void }, entries: () => Entry[]) {
  if (!isTauri()) return;
  e.preventDefault();
  build(entries())
    .then((items) => Menu.new({ items }))
    .then((menu) => menu.popup())
    .catch((err) => warn("context menu", err));
}

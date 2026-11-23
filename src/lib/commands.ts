/**
 * アプリの操作の表。メニュー・キー操作・画面のボタンは、この表から使う
 * （stockroom の src/lib/commands.ts と同じ考え方）。操作を足すときは、まずここに足す。
 *
 * キーは "Mod+Shift+R" のように書く。Mod は macOS では ⌘、ほかでは Ctrl。
 */
import { applyAppearance, nextAppearance, type Appearance } from "./appearance";
import { api } from "./api";
import { composing } from "./ime";
import { warn } from "./log";
import { checkForUpdate } from "./update";
import { useStore } from "../store";

export type Command = {
  id: string;
  label: string;
  keys?: string[];
  /** 文字の入力欄にいるときも効かせるか（既定は効かせない。スペースや矢印は入力に使うため）。 */
  inFields?: boolean;
  run: () => void;
};

let appearance: Appearance = "system";
const st = () => useStore.getState();

export const COMMANDS: Command[] = [
  // ファイル
  { id: "file.quickLook", label: "Quick Look", keys: ["Space"], run: () => st().quickLook() },
  { id: "file.open", label: "開く", keys: ["Enter", "Mod+ArrowDown"], run: () => st().openSelected() },
  { id: "file.reveal", label: "Finder / エクスプローラーで表示", keys: ["Mod+Shift+R"], run: () => st().revealSelected() },
  { id: "file.copyPath", label: "パスをコピー", keys: ["Mod+Alt+C"], run: () => st().copyPaths() },

  // 選ぶ
  { id: "select.all", label: "すべて選ぶ", keys: ["Mod+A"], run: () => st().selectAll() },
  { id: "select.none", label: "選ぶのをやめる", keys: ["Escape"], run: () => st().clearSelection() },
  { id: "select.down", label: "次", keys: ["ArrowDown"], run: () => st().step(1, false) },
  { id: "select.up", label: "前", keys: ["ArrowUp"], run: () => st().step(-1, false) },
  { id: "select.downMore", label: "次まで選ぶ", keys: ["Shift+ArrowDown"], run: () => st().step(1, true) },
  { id: "select.upMore", label: "前まで選ぶ", keys: ["Shift+ArrowUp"], run: () => st().step(-1, true) },

  // 整理
  { id: "tag.new", label: "新しいタグ", run: () => st().setEditing({ kind: "newTag" }) },
  {
    id: "vfolder.new",
    label: "新しい仮想フォルダ",
    keys: ["Mod+Shift+N"],
    run: () => {
      // 仮想フォルダを開いていれば、その中に作る
      const p = st().place;
      st().setEditing({ kind: "newFolder", parentId: p.kind === "folder" ? p.id : null });
    },
  },

  // 登録フォルダ
  { id: "folder.add", label: "フォルダを登録…", keys: ["Mod+O"], inFields: true, run: () => void st().addRootDialog() },
  {
    id: "folder.remove",
    label: "登録を外す",
    run: () => {
      const p = st().place;
      if (p.kind === "root") void st().removeRoot(p.id);
    },
  },
  { id: "folder.rescan", label: "読み直す", keys: ["Mod+R"], inFields: true, run: () => void api.rescan() },

  // 表示・ヘルプ
  {
    id: "view.appearance",
    label: "外観を切り替える",
    keys: ["Mod+Shift+L"],
    inFields: true,
    run: () => {
      appearance = nextAppearance(appearance);
      applyAppearance(appearance);
    },
  },
  { id: "help.update", label: "アップデートを確認…", run: () => checkForUpdate(true) },
  { id: "help.log", label: "ログを表示", run: () => api.revealLog().catch((e) => warn("reveal log", e)) },
];

const isMac = navigator.userAgent.includes("Mac");

/** "Mod+Shift+L" と押されたキーが合うか。 */
function matches(keys: string, e: KeyboardEvent): boolean {
  const parts = keys.split("+");
  const last = parts.pop()!;
  const key = last === "Space" ? " " : last;
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const same = key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
  return same && mod === want.has("Mod") && e.shiftKey === want.has("Shift") && e.altKey === want.has("Alt");
}

/** 文字を打つ場所にいるか。 */
function inField(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** 表のキーで操作を実行する。戻り値は後片付け。 */
export function listenCommandKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (composing(e)) return;
    const field = inField(e);
    const cmd = COMMANDS.find((c) => (!field || c.inFields) && c.keys?.some((k) => matches(k, e)));
    if (!cmd) return;
    e.preventDefault();
    cmd.run();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

/** ボタンなどから表の操作を実行する（操作の中身を画面の部品に書かない）。 */
export function runCommand(id: string) {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (cmd) cmd.run();
  else warn(`unknown command: ${id}`);
}

/** 表示用のキー（⌘O / Ctrl+O）。 */
export function keyLabel(id: string): string {
  const k = COMMANDS.find((c) => c.id === id)?.keys?.[0];
  if (!k) return "";
  const map: Record<string, string> = isMac
    ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", ArrowDown: "↓", ArrowUp: "↑", Space: "スペース", Enter: "↩" }
    : { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", ArrowDown: "↓", ArrowUp: "↑", Space: "スペース", Enter: "Enter" };
  return k
    .split("+")
    .map((p) => map[p] ?? p)
    .join("");
}

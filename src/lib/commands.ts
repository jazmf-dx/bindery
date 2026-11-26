/**
 * アプリの操作の表。メニュー・キー操作・画面のボタンは、この表から使う
 * （stockroom の src/lib/commands.ts と同じ考え方）。操作を足すときは、まずここに足す。
 *
 * キーは "Mod+Shift+R" のように書く。Mod は macOS では ⌘、ほかでは Ctrl。
 */
import { appearanceLabel, nextAppearance, type Appearance } from "./appearance";
import { api } from "./api";
import { composing } from "./ime";
import { warn } from "./log";
import { checkForUpdate } from "./update";
import { useStore } from "../store";
import { useShortcutHelp } from "../components/ShortcutHelp";

export type Command = {
  id: string;
  label: string;
  keys?: string[];
  /** 文字の入力欄にいるときも効かせるか（既定は効かせない。スペースや矢印は入力に使うため）。 */
  inFields?: boolean;
  run: () => void;
};

/** 絞り込みの入力欄の id。 */
export const SEARCH_FIELD = "bindery-search";
const st = () => useStore.getState();
const grid = () => st().prefs.layout === "grid";
const rowStep = () => (grid() ? st().gridCols : 1);

export const COMMANDS: Command[] = [
  // ファイル
  { id: "file.quickLook", label: "Quick Look", keys: ["Space"], run: () => st().quickLook() },
  { id: "file.open", label: "開く", keys: ["Enter", "Mod+ArrowDown"], run: () => st().openSelected() },
  { id: "file.reveal", label: "Finder / エクスプローラーで表示", keys: ["Mod+Shift+R"], run: () => st().revealSelected() },
  { id: "file.copyPath", label: "パスをコピー", keys: ["Mod+Alt+C"], run: () => st().copyPaths() },
  { id: "file.removeFromPlace", label: "今のタグ・仮想フォルダから外す", run: () => void st().removeFromPlace() },
  { id: "file.relink", label: "つなぎ直す…", run: () => void st().relinkSelected() },
  { id: "file.forget", label: "記録を外す…", run: () => void st().forgetSelected() },

  // 探す
  {
    id: "find",
    label: "絞り込む",
    keys: ["Mod+F"],
    inFields: true,
    // 一覧の上の入力欄へ（FileList.tsx の Header）
    run: () => {
      const el = document.getElementById(SEARCH_FIELD);
      if (el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      }
    },
  },

  // 選ぶ
  {
    id: "select.all",
    label: "すべて選ぶ",
    keys: ["Mod+A"],
    inFields: true,
    // 文字の入力欄にいるときは、その文字を全部選ぶ（メニューの accelerator が先に受けるため）
    run: () => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
      else st().selectAll();
    },
  },
  { id: "select.none", label: "選ぶのをやめる", keys: ["Escape"], run: () => st().clearSelection() },
  // グリッドでは、上下は 1 行（その行の数）ずつ、左右は 1 つずつ動く
  { id: "select.down", label: "次", keys: ["ArrowDown"], run: () => st().step(rowStep(), false) },
  { id: "select.up", label: "前", keys: ["ArrowUp"], run: () => st().step(-rowStep(), false) },
  { id: "select.downMore", label: "次まで選ぶ", keys: ["Shift+ArrowDown"], run: () => st().step(rowStep(), true) },
  { id: "select.upMore", label: "前まで選ぶ", keys: ["Shift+ArrowUp"], run: () => st().step(-rowStep(), true) },
  { id: "select.right", label: "右", keys: ["ArrowRight"], run: () => grid() && st().step(1, false) },
  { id: "select.left", label: "左", keys: ["ArrowLeft"], run: () => grid() && st().step(-1, false) },
  { id: "select.rightMore", label: "右まで選ぶ", keys: ["Shift+ArrowRight"], run: () => grid() && st().step(1, true) },
  { id: "select.leftMore", label: "左まで選ぶ", keys: ["Shift+ArrowLeft"], run: () => grid() && st().step(-1, true) },

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
  {
    id: "folder.reveal",
    label: "Finder / エクスプローラーで表示",
    run: () => {
      const p = st().place;
      if (p.kind === "root") st().revealRoot(p.id, p.dir);
    },
  },
  { id: "folder.up", label: "上のフォルダへ", keys: ["Mod+ArrowUp"], run: () => st().goUp() },
  { id: "folder.rescan", label: "読み直す", keys: ["Mod+R"], inFields: true, run: () => void api.rescan() },

  // 表示（docs/CONCEPT.md「ツールバーと表示の切り替え」）
  { id: "view.grid", label: "グリッド", keys: ["Mod+1"], run: () => st().setLayout("grid") },
  { id: "view.list", label: "リスト", keys: ["Mod+2"], run: () => st().setLayout("list") },
  // パネルのキーは stockroom と同じ（Tab は入力欄の中では字下げなどに使うので、欄の外でだけ）
  { id: "view.sidebar", label: "サイドバーを表示／隠す", keys: ["Tab", "Mod+Alt+1"], run: () => st().toggleSidebar() },
  { id: "view.details", label: "詳細パネルを表示／隠す", keys: ["Mod+I", "Mod+Alt+2"], run: () => st().toggleDetails() },

  // 表示・ヘルプ
  // 外観（stockroom と同じ：ツールバーのボタンと ⌘⇧D はシステム → ライト → ダークの順に回す）
  {
    id: "view.appearance",
    label: "外観を切り替える",
    keys: ["Mod+Shift+D"],
    inFields: true,
    run: () => st().setAppearance(nextAppearance(st().appearance)),
  },
  ...(["system", "light", "dark"] as Appearance[]).map((a) => ({ id: `view.appearance.${a}`, label: appearanceLabel(a), run: () => st().setAppearance(a) })),
  {
    id: "help.shortcuts",
    label: "キーボードショートカット",
    // ? は打った文字で受ける（キーボードの配列によらない。ShortcutHelp.tsx）。ここでは一覧と表示のためだけ
    keys: ["?"],
    run: () => useShortcutHelp.getState().setOpen(true),
  },
  { id: "help.update", label: "アップデートを確認…", run: () => checkForUpdate(true) },
  { id: "help.log", label: "ログを表示", run: () => api.revealLog().catch((e) => warn("reveal log", e)) },
];

export const isMac = navigator.userAgent.includes("Mac");

/**
 * メニューバーがある（アプリの中）とき、⌘ / Ctrl の組み合わせはメニューの accelerator が受ける
 * （src/lib/menuBar.ts）。ページでも受けると 2 回動くので、ページでは受けない。
 */
let menuTakesMod = false;
export function setMenuTakesMod(on: boolean) {
  menuTakesMod = on;
}

/** "Mod+Shift+L" と押されたキーが合うか。 */
function matches(keys: string, e: KeyboardEvent): boolean {
  const parts = keys.split("+");
  const last = parts.pop()!;
  const key = last === "Space" ? " " : last;
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  // ⌥ を押すと macOS では e.key が別の文字になるので、1 文字のキーは物理キー（e.code）でも見る
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : null;
  const same = key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() || e.code === code : e.key === key;
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
    const cmd = COMMANDS.find(
      (c) => (!field || c.inFields) && c.keys?.some((k) => !(menuTakesMod && k.includes("Mod+")) && matches(k, e)),
    );
    if (!cmd) return;
    e.preventDefault();
    cmd.run();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

export function command(id: string): Command {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown command: ${id}`);
  return c;
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

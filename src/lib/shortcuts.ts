/**
 * ショートカット一覧（?）に出すキーとマウスの操作（stockroom の src/lib/shortcuts.ts と同じ形）。
 * 操作の行はコマンド表（commands.ts）から作る。メニューもキー操作も同じ表を使うので、表とずれない。
 * 表に無いもの（マウス・フォルダの行など）だけ、ここに書く。
 *
 * キーは "Mod+Shift+R" のように書く。Mod は macOS では ⌘、ほかでは Ctrl。
 * "Click"・"Drag"・"DoubleClick"・"RightClick" はマウスの操作。
 */
import { command } from "./commands";

export const isMac = navigator.userAgent.includes("Mac");

export type ShortcutRow = {
  label: string;
  /** どれを押しても同じ（「/」で区切って出す）。 */
  keys: string[];
};

export type ShortcutSection = { id: string; title: string; rows: ShortcutRow[] };

/** コマンドの行。`over` で名前やキーを足す。 */
function cmd(id: string, over: Partial<ShortcutRow> = {}): ShortcutRow {
  const c = command(id);
  return { label: c.label, keys: c.keys ?? [], ...over };
}

/** 2 つのコマンドを 1 行に（「グリッド / リスト」）。 */
function pair(a: string, b: string, label: string): ShortcutRow {
  return { label, keys: [...(command(a).keys ?? []), ...(command(b).keys ?? [])] };
}

let sections: ShortcutSection[] | null = null;

/** はじめて使うときに作る（コマンド表を先に読み込むため）。 */
export function shortcutSections(): ShortcutSection[] {
  sections ??= [
    {
      id: "general",
      title: "全体",
      rows: [
        cmd("find", { label: "今の場所の中を絞り込む" }),
        pair("view.grid", "view.list", "グリッド / リスト"),
        cmd("view.sidebar"),
        cmd("view.details"),
        cmd("view.appearance", { label: "外観を切り替える（システム → ライト → ダーク）" }),
        cmd("folder.rescan"),
        cmd("folder.add"),
        cmd("help.shortcuts", { label: "ショートカット一覧" }),
      ],
    },
    {
      id: "select",
      title: "一覧で選ぶ",
      rows: [
        { label: "選ぶ", keys: ["Click"] },
        { label: "足す・外す", keys: ["Mod+Click"] },
        { label: "範囲を選ぶ", keys: ["Shift+Click"] },
        pair("select.up", "select.down", "前 / 次（グリッドでは上 / 下の行）"),
        pair("select.upMore", "select.downMore", "前 / 次まで選ぶ"),
        pair("select.left", "select.right", "左 / 右（グリッド）"),
        cmd("select.all"),
        cmd("select.none"),
      ],
    },
    {
      id: "file",
      title: "ファイル",
      rows: [
        cmd("file.open", { keys: [...(command("file.open").keys ?? []), "DoubleClick"] }),
        cmd("file.quickLook"),
        cmd("file.reveal"),
        cmd("file.copyPath"),
        { label: "メニューを出す", keys: ["RightClick"] },
      ],
    },
    {
      id: "organize",
      title: "整理",
      rows: [
        { label: "タグを付ける・仮想フォルダに入れる（サイドバーへ落とす）", keys: ["Drag"] },
        cmd("vfolder.new"),
        { label: "仮想フォルダを別の仮想フォルダの下へ移す", keys: ["Drag"] },
      ],
    },
    {
      id: "folder",
      title: "フォルダ",
      rows: [
        { label: "一覧の中のフォルダに入る", keys: ["Enter", "DoubleClick"] },
        cmd("folder.up"),
        { label: "フォルダを登録する（ウィンドウへ落とす）", keys: ["Drag"] },
      ],
    },
    {
      id: "input",
      title: "入力・メニュー",
      rows: [
        { label: "閉じる・入力をやめる・絞り込みを空にする", keys: ["Escape"] },
        { label: "決める（タグの名前・絞り込みから一覧へ）", keys: ["Enter"] },
      ],
    },
  ];
  return sections;
}

// ------------------------------------------------------------ 表示

const MOUSE: Record<string, string> = { Click: "クリック", DoubleClick: "ダブルクリック", RightClick: "右クリック", Drag: "ドラッグ" };

const NAMES: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "スペース", Escape: "Esc" };
// "↩" は絵文字で描かれるので、名前で出す
const MAC: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Enter: "Return" };
const OTHER: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** 出すときのキーかマウスの操作。`cap` はキーの形で描く。 */
export type KeyPart = { text: string; cap: boolean };

export function keyParts(combo: string): KeyPart[] {
  // 最後が「+」のキーは無いので、そのまま + で区切る
  return combo.split("+").map((p) => {
    if (MOUSE[p]) return { text: MOUSE[p], cap: false };
    return { text: (isMac ? MAC : OTHER)[p] ?? NAMES[p] ?? p, cap: true };
  });
}

/** 「⌘⇧R」「Ctrl+Shift+R」：探すときの読み方。 */
export const comboText = (combo: string) =>
  keyParts(combo)
    .map((p) => p.text)
    .join(isMac ? "" : "+");

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s+]/g, "");

/** 名前か、キー（「⌘R」「ctrl+r」「F」）で探す。 */
export function matchRow(row: ShortcutRow, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  if (norm(row.label).includes(q)) return true;
  return row.keys.some((k) => {
    const shown = norm(comboText(k));
    const last = norm(keyParts(k).at(-1)?.text ?? "");
    return shown === q || last === q || norm(k) === q;
  });
}

/**
 * アプリの操作の表。メニュー・右クリック・キー操作は、この表から作る
 * （stockroom の src/lib/commands.ts と同じ考え方）。操作を足すときは、まずここに足す。
 *
 * キーは "Mod+Shift+R" のように書く。Mod は macOS では ⌘、ほかでは Ctrl。
 */
import { applyAppearance, nextAppearance, type Appearance } from "./appearance";
import { api } from "./api";
import { warn } from "./log";
import { checkForUpdate } from "./update";

export type Command = {
  id: string;
  label: string;
  keys?: string[];
  run: () => void;
};

let appearance: Appearance = "system";

export const COMMANDS: Command[] = [
  {
    id: "view.appearance",
    label: "外観を切り替える",
    keys: ["Mod+Shift+L"],
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
  const key = parts.pop()!.toLowerCase();
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return (
    e.key.toLowerCase() === key &&
    mod === want.has("Mod") &&
    e.shiftKey === want.has("Shift") &&
    e.altKey === want.has("Alt")
  );
}

/** 表のキーで操作を実行する。戻り値は後片付け。 */
export function listenCommandKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const cmd = COMMANDS.find((c) => c.keys?.some((k) => matches(k, e)));
    if (!cmd) return;
    e.preventDefault();
    cmd.run();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

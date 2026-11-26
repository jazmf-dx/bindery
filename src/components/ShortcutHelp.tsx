/**
 * キーボードショートカットの一覧（stockroom の ShortcutHelp.tsx と同じ形）。
 * ?（文字の入力欄の外で）か、メニューの［ヘルプ］→［キーボードショートカット］で開く。
 * 名前かキーで探せる。開いているあいだは、キーを一覧のほうへ届けない。Esc・? ・外を押すと閉じる。
 */
import { useEffect, useMemo, useState } from "react";
import { Keyboard, Search, X } from "lucide-react";
import { create } from "zustand";
import { composing } from "../lib/ime";
import { isMac, keyParts, matchRow, shortcutSections } from "../lib/shortcuts";

export const useShortcutHelp = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select");

/**
 * ? は打った文字で受ける（キーボードの配列によらない）。⌘? は macOS のヘルプの検索に残す。
 * 開いているあいだは、どのキーも先に受けて一覧へ届けない。
 */
function useShortcutKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { open, setOpen } = useShortcutHelp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "?" && !mod && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(!open);
        return;
      }
      if (!open) return;
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !composing(e)) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

export function ShortcutHelp() {
  useShortcutKeys();
  const open = useShortcutHelp((s) => s.open);
  return open ? <Panel /> : null;
}

function Panel() {
  const setOpen = useShortcutHelp((s) => s.setOpen);
  const [query, setQuery] = useState("");
  const sections = useMemo(
    () =>
      shortcutSections()
        .map((s) => ({ ...s, rows: s.rows.filter((row) => matchRow(row, query)) }))
        .filter((s) => s.rows.length > 0),
    [query],
  );

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50" onPointerDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="キーボードショートカット"
        className="flex max-h-[85vh] w-[880px] max-w-[94vw] animate-zoom-in flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Keyboard size={16} className="shrink-0 text-accent" />
          <h2 className="text-[14px] font-semibold whitespace-nowrap">キーボードショートカット</h2>
          <label className="ml-auto flex h-8 w-64 min-w-0 items-center gap-2 rounded-md border border-edge bg-field px-2 focus-within:border-accent">
            <Search size={14} className="shrink-0 text-dim" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`名前かキーで探す（開く、${isMac ? "⌘R" : "Ctrl+R"}）`}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
            />
            {query && (
              <button aria-label="探すのをやめる" onClick={() => setQuery("")} className="text-dim hover:text-fg">
                <X size={14} />
              </button>
            )}
          </label>
          <button title="閉じる（Esc / ?）" aria-label="閉じる" onClick={() => setOpen(false)} className="ghost rounded-md p-1 text-dim">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {sections.length === 0 ? (
            <p className="py-12 text-center text-dim">「{query}」に当てはまるショートカットはありません</p>
          ) : (
            <div className="columns-[18rem] gap-8">
              {sections.map((s) => (
                <section key={s.id} className="mb-5 break-inside-avoid">
                  <h3 className="mb-1 text-[12px] font-semibold text-dim">{s.title}</h3>
                  <ul>
                    {s.rows.map((row) => (
                      <li key={row.label} className="flex items-start justify-between gap-3 border-b border-line/50 py-1.5">
                        <span className="min-w-0 pt-px">{row.label}</span>
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-1 gap-y-1">
                          {row.keys.map((k, i) => (
                            <span key={k} className="flex items-center gap-1">
                              {i > 0 && <span className="text-[11px] text-dim/60">/</span>}
                              <Combo combo={k} />
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        {isMac && <div className="border-t border-line px-5 py-2 text-[11px] text-dim">⌘ Command　⌥ Option　⇧ Shift</div>}
      </div>
    </div>
  );
}

function Combo({ combo }: { combo: string }) {
  return (
    <span className="flex items-center gap-0.5">
      {keyParts(combo).map((p, i) =>
        p.cap ? (
          <kbd key={i} className="min-w-5 rounded border border-b-2 border-line bg-raised px-1.5 text-center font-sans text-[11px] leading-[18px] text-fg">
            {p.text}
          </kbd>
        ) : (
          <span key={i} className="px-0.5 text-[11px] text-dim">
            {p.text}
          </span>
        ),
      )}
    </span>
  );
}

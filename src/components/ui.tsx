/** 画面のあちこちで使う小さな部品。 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { composing } from "../lib/ime";

/** サイドバーのまとまり。`drop` を渡すと、見出しがドラッグの落とし先になる（DragLayer.tsx）。 */
export function Section({ title, action, drop, children }: { title?: string; action?: ReactNode; drop?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {title && (
        <div data-drop={drop} className="flex items-center rounded-md px-2 pb-1 data-[over]:!bg-tonal data-[over]:!text-on-tonal">
          <span className="flex-1 text-[11px] font-semibold text-dim">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** 名前を打ち込む欄。Enter で決め、Esc か欄の外で取りやめる（空のときも取りやめ）。 */
export function NameInput({ initial = "", placeholder, onDone }: { initial?: string; placeholder?: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name && name.trim() ? name.trim() : null);
  };
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (composing(e)) return;
        if (e.key === "Enter") finish(value);
        else if (e.key === "Escape") finish(null);
        e.stopPropagation();
      }}
      onBlur={() => finish(value)}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded border border-accent bg-field px-1.5 py-0.5 outline-none"
    />
  );
}

/** 指したときだけ見える小さなボタン（行の幅と位置は変えない）。 */
export function HoverButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      className="ghost invisible rounded p-0.5 text-dim group-hover:visible"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

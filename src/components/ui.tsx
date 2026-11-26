/** 画面のあちこちで使う小さな部品。 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
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

/**
 * ボタンの下に開く小さなメニュー（条件・表示）。ウィンドウに対して置く（横に流れる行で切れないように）。
 * 外を押すか Esc で閉じる。Esc は一覧の「選ぶのをやめる」へ届けない。
 */
export function Popover({
  anchor,
  onClose,
  width = "w-56",
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  width?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = ref.current?.offsetWidth ?? 0;
      setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 4 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }}
      className={`z-40 ${width} max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-raised p-1 text-[12px] shadow-xl`}
    >
      {children}
    </div>
  );
}

/** メニューの見出し。 */
export const MenuHeading = ({ children }: { children: ReactNode }) => <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold text-dim">{children}</div>;

/** メニューの選択肢：印（複数選べるものは四角、1 つだけのものは丸）・名前・件数。 */
export function MenuOption({
  on,
  single,
  count,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  single?: boolean;
  count?: number;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left enabled:hover:bg-hover disabled:off ${!on && count === 0 ? "text-dim" : ""}`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${single ? "rounded-full" : "rounded-sm"} ${
          on ? "border-accent bg-accent-fill text-white" : "border-edge"
        }`}
      >
        {on && <Check size={10} strokeWidth={3} />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{children}</span>
      {count !== undefined && <span className="shrink-0 text-dim tabular-nums">{count}</span>}
    </button>
  );
}

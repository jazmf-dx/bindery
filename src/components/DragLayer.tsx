/**
 * 一覧からのドラッグ（FileList.tsx の `startDrag` が始める）。カーソルの横に名前を出し、
 * 下にある落とし先（サイドバーの `data-drop="tag:ID"` / `"folder:ID"`）に印を付け、
 * 離したところへタグを付ける・仮想フォルダに入れる。Esc で取りやめる。
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";

function targetAt(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;
}

export function DragLayer() {
  const drag = useStore((s) => s.drag);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    let over: HTMLElement | null = null;
    const mark = (el: HTMLElement | null) => {
      if (over === el) return;
      over?.removeAttribute("data-over");
      el?.setAttribute("data-over", "");
      over = el;
    };
    const end = () => {
      mark(null);
      setPos(null);
      useStore.getState().setDrag(null);
      document.documentElement.removeAttribute("data-dragging");
    };
    const move = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
      mark(targetAt(e.clientX, e.clientY));
    };
    const up = (e: MouseEvent) => {
      const el = targetAt(e.clientX, e.clientY);
      end();
      const [kind, id] = (el?.dataset.drop ?? "").split(":");
      const st = useStore.getState();
      if (kind === "tag") void st.setTag(drag.ids, Number(id), true);
      else if (kind === "folder") void st.setFolder(drag.ids, Number(id), true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        end();
      }
    };
    document.documentElement.setAttribute("data-dragging", "");
    setPos({ x: drag.x, y: drag.y });
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key, true);
    };
  }, [drag]);

  if (!drag || !pos) return null;
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-64 truncate rounded-md bg-accent-fill px-2 py-1 text-white shadow-lg"
      style={{ left: pos.x + 14, top: pos.y + 10 }}
    >
      {drag.label}
    </div>
  );
}

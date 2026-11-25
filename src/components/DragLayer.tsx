/**
 * ドラッグ。カーソルの横に名前を出し、下にある落とし先（サイドバーの `data-drop`）に印を付ける。Esc で取りやめる。
 * - 一覧の行（FileList.tsx `startDrag`）：`tag:ID` へ落とすとタグを付け、`folder:ID` へ落とすと仮想フォルダに入れる
 * - 仮想フォルダの行（Sidebar.tsx `startFolderDrag`）：`folder:ID` へ落とすとその下へ、`folder:top` へ落とすと一番上へ移す
 */
import { useEffect, useState } from "react";
import { useStore, type Drag } from "../store";

/** そのドラッグで落とせる先か。 */
function accepts(drag: Drag, drop: string): boolean {
  const [kind, id] = drop.split(":");
  if (drag.folder !== undefined) return kind === "folder" && id !== String(drag.folder);
  return (kind === "tag" || kind === "folder") && id !== "top";
}

function targetAt(drag: Drag, x: number, y: number): HTMLElement | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;
  return el && accepts(drag, el.dataset.drop ?? "") ? el : null;
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
      mark(targetAt(drag, e.clientX, e.clientY));
    };
    const up = (e: MouseEvent) => {
      const el = targetAt(drag, e.clientX, e.clientY);
      end();
      if (!el) return;
      const [kind, id] = (el.dataset.drop ?? "").split(":");
      const st = useStore.getState();
      if (drag.folder !== undefined) void st.moveFolder(drag.folder, id === "top" ? null : Number(id));
      else if (kind === "tag") void st.setTag(drag.ids, Number(id), true);
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

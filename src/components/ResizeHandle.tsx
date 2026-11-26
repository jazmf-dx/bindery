/**
 * 左右のパネルの境目。ドラッグで幅を変え、ダブルクリックで元の幅に戻す（stockroom の ResizeHandle.tsx と同じ）。
 * ドラッグしているあいだは、パネルの開け閉めの動きを止めて、境目がカーソルについてくるようにする。
 */
import { useState } from "react";
import { PANEL_WIDTH, type Panel } from "../lib/view";
import { useStore } from "../store";

export function ResizeHandle({ panel, onResizing }: { panel: Panel; onResizing: (on: boolean) => void }) {
  const [active, setActive] = useState(false);
  // サイドバーは右へ、詳細パネルは左へ広がる
  const dir = panel === "sidebar" ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { prefs } = useStore.getState();
    const start = panel === "sidebar" ? prefs.sidebarWidth : prefs.detailsWidth;
    const x0 = e.clientX;
    setActive(true);
    onResizing(true);
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => useStore.getState().setPanelWidth(panel, start + (ev.clientX - x0) * dir);
    const up = () => {
      setActive(false);
      onResizing(false);
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="ドラッグで幅を変える（ダブルクリックで元の幅に戻す）"
      onPointerDown={onPointerDown}
      onDoubleClick={() => useStore.getState().setPanelWidth(panel, PANEL_WIDTH[panel].initial)}
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize ${panel === "sidebar" ? "-right-1" : "-left-1"}`}
    >
      <div className={`mx-auto h-full w-0.5 transition-colors ${active ? "bg-accent" : "bg-transparent group-hover:bg-accent/60"}`} />
    </div>
  );
}

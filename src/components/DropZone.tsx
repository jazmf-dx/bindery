/**
 * Finder / エクスプローラーからウィンドウへ落としたフォルダを登録する（store.ts `addRoots`）。
 * ファイルだけを落としたときは、入っているフォルダを直下だけで登録して、そのファイルを選ぶ。
 * 重ねているあいだは、ウィンドウ全体に「落とすと登録する」と出す。
 * Tauri がウィンドウへのドロップを受けて知らせる（`onDragDropEvent`）。ページのドラッグ＆ドロップは使わない
 * （docs/ARCHITECTURE.md「ドラッグ」）。ブラウザ（モック）では動かない。
 */
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FolderPlus } from "lucide-react";
import { warn } from "../lib/log";
import { useStore } from "../store";

export function DropZone() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const stop = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter") setOver(p.paths.length > 0);
      else if (p.type === "leave") setOver(false);
      else if (p.type === "drop") {
        setOver(false);
        if (p.paths.length) void useStore.getState().addRoots(p.paths);
      }
    });
    return () => {
      stop.then((f) => f()).catch((e) => warn("drop", e));
    };
  }, []);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-accent-fill bg-panel px-10 py-8 text-center">
        <FolderPlus size={28} className="text-dim" />
        <div className="font-semibold">落とすと、フォルダを登録します</div>
        <div className="text-[12px] text-dim">ファイルは元の場所に置いたままです。ファイルを落としたときは、入っているフォルダを登録して選びます</div>
      </div>
    </div>
  );
}

/**
 * 画面（docs/CONCEPT.md「決めたこと」の画面）。左からサイドバー・一覧・詳細パネルの 3 列。
 * 選ぶ項目を変えても、この 3 列の位置と幅は変えない（desktop-platform UI Standard「レイアウトの安定」）。
 * 左右のパネルは隠せて、境目のドラッグで幅を変えられる（docs/CONCEPT.md「ツールバーと表示の切り替え」）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Details } from "./components/Details";
import { DragLayer } from "./components/DragLayer";
import { DropZone } from "./components/DropZone";
import { FileList } from "./components/FileList";
import { ResizeHandle } from "./components/ResizeHandle";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { api, FILES_CHANGED, SCAN_STATE } from "./lib/api";
import { listenCommandKeys } from "./lib/commands";
import { scheduleUpdateCheck } from "./lib/update";
import type { Panel } from "./lib/view";
import { useStore } from "./store";

export default function App() {
  useEffect(() => {
    const st = useStore.getState();
    st.load();
    api.scanStatus().then(st.setScanning, () => {});
    const unlisten = [
      listen(FILES_CHANGED, () => useStore.getState().load()),
      listen<boolean>(SCAN_STATE, (e) => useStore.getState().setScanning(e.payload)),
    ];
    const stopKeys = listenCommandKeys();
    const stopUpdate = scheduleUpdateCheck();
    return () => {
      unlisten.forEach((p) => p.then((f) => f()).catch(() => {}));
      stopKeys();
      stopUpdate();
    };
  }, []);

  const prefs = useStore((s) => s.prefs);
  // 境目をドラッグしているあいだは、幅の動きを止める
  const [resizing, setResizing] = useState(false);

  return (
    <div className="flex h-full">
      <SidePanel panel="sidebar" open={prefs.sidebarOpen} width={prefs.sidebarWidth} resizing={resizing} onResizing={setResizing}>
        <Sidebar />
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <Toolbar />
        <FileList />
      </main>
      <SidePanel panel="details" open={prefs.detailsOpen} width={prefs.detailsWidth} resizing={resizing} onResizing={setResizing}>
        <Details />
      </SidePanel>
      <DragLayer />
      <DropZone />
      <ShortcutHelp />
    </div>
  );
}

/**
 * 左右のパネルの入れ物。隠すと幅を 0 にする（中身の幅はそのままにして、動いているあいだも組み直さない）。
 */
function SidePanel({ panel, open, width, resizing, onResizing, children }: { panel: Panel; open: boolean; width: number; resizing: boolean; onResizing: (on: boolean) => void; children: ReactNode }) {
  return (
    <div className={`relative flex shrink-0 ${resizing ? "" : "transition-[width] duration-200 ease-out"}`} style={{ width: open ? width : 0 }}>
      <div className={`flex h-full overflow-hidden ${panel === "details" ? "justify-end" : ""}`} style={{ width: open ? width : 0 }}>
        <div className="flex h-full shrink-0" style={{ width }}>
          {children}
        </div>
      </div>
      {open && <ResizeHandle panel={panel} onResizing={onResizing} />}
    </div>
  );
}

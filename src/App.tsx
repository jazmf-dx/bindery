/**
 * 画面（docs/CONCEPT.md「決めたこと」の画面）。左からサイドバー・一覧・詳細パネルの 3 列。
 * 選ぶ項目を変えても、この 3 列の位置と幅は変えない（desktop-platform UI Standard「レイアウトの安定」）。
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Details } from "./components/Details";
import { DragLayer } from "./components/DragLayer";
import { DropZone } from "./components/DropZone";
import { ConditionBar, FileList, Header } from "./components/FileList";
import { Sidebar } from "./components/Sidebar";
import { api, FILES_CHANGED, SCAN_STATE } from "./lib/api";
import { listenCommandKeys } from "./lib/commands";
import { scheduleUpdateCheck } from "./lib/update";
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

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <Header />
        <ConditionBar />
        <FileList />
      </main>
      <Details />
      <DragLayer />
      <DropZone />
    </div>
  );
}

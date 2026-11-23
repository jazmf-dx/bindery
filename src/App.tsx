/**
 * 画面（docs/CONCEPT.md「決めたこと」の画面）。左からサイドバー・リスト・詳細パネルの 3 列。
 * 選ぶ項目を変えても、この 3 列の位置と幅は変えない（desktop-platform UI Standard「レイアウトの安定」）。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileSpreadsheet, FileText, FileType, Folder, FolderPlus, HelpCircle, Inbox, Layers, Presentation, RefreshCw, X } from "lucide-react";
import { api, FILES_CHANGED, SCAN_STATE, type FileRow, type Root } from "./lib/api";
import { listenCommandKeys, runCommand } from "./lib/commands";
import { formatDate, formatSize, kindLabel, kindOf, relativeDir } from "./lib/kinds";
import { dragRegion } from "./lib/titleBar";
import { scheduleUpdateCheck } from "./lib/update";
import { useStore, type Place } from "./store";

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
        <FileList />
      </main>
      <Details />
    </div>
  );
}

// ------------------------------------------------------------ サイドバー

/** 上から 未整理・行方不明 → 仮想フォルダ → タグ → 登録フォルダ。 */
function Sidebar() {
  const roots = useStore((s) => s.roots);
  const place = useStore((s) => s.place);
  const missingCount = useStore((s) => s.missingCount);
  const go = useStore((s) => s.go);
  const is = (p: Place) => place.view === p.view && place.rootId === p.rootId;

  return (
    <nav className="vibrant flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel px-2 pb-3" {...dragRegion(true)}>
      <div className="h-[var(--titlebar)] shrink-0" />
      <Section>
        <Row icon={<Layers size={15} />} label="すべてのファイル" active={is({ view: "all", rootId: null })} onClick={() => go({ view: "all", rootId: null })} />
        <Row icon={<Inbox size={15} />} label="未整理" active={is({ view: "unsorted", rootId: null })} onClick={() => go({ view: "unsorted", rootId: null })} />
        <Row
          icon={<HelpCircle size={15} />}
          label="行方不明"
          count={missingCount || undefined}
          active={is({ view: "missing", rootId: null })}
          onClick={() => go({ view: "missing", rootId: null })}
        />
      </Section>
      <Section title="仮想フォルダ">
        <Empty />
      </Section>
      <Section title="タグ">
        <Empty />
      </Section>
      <Section title="登録フォルダ">
        {roots.map((r) => (
          <RootRow key={r.id} root={r} active={is({ view: "all", rootId: r.id })} onClick={() => go({ view: "all", rootId: r.id })} />
        ))}
        <Row icon={<FolderPlus size={15} />} label="フォルダを登録…" dim onClick={() => runCommand("folder.add")} />
      </Section>
    </nav>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {title && <div className="px-2 pb-1 text-[11px] font-semibold text-dim">{title}</div>}
      {children}
    </div>
  );
}

function Row(props: { icon: ReactNode; label: string; count?: number; title?: string; active?: boolean; dim?: boolean; onClick?: () => void; trailing?: ReactNode }) {
  const { icon, label, count, title, active, dim, onClick, trailing } = props;
  return (
    <div
      role="button"
      title={title}
      onClick={onClick}
      className={`group flex cursor-default items-center gap-2 rounded-md px-2 py-1 ${active ? "bg-chosen" : "ghost"} ${dim ? "text-dim" : ""}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] text-dim tabular-nums">{count}</span>}
      {trailing}
    </div>
  );
}

function RootRow({ root, active, onClick }: { root: Root; active: boolean; onClick: () => void }) {
  const removeRoot = useStore((s) => s.removeRoot);
  return (
    <Row
      icon={<Folder size={15} />}
      label={root.name}
      title={root.path}
      count={root.count}
      active={active}
      onClick={onClick}
      // 外すボタンは、件数の右に置き、指したときだけ見せる（行の幅と件数の位置は変えない）。
      trailing={
        <button
          aria-label={`「${root.name}」の登録を外す`}
          title="登録を外す（元のファイルには触りません）"
          className="ghost invisible rounded p-0.5 text-dim group-hover:visible"
          onClick={(e) => {
            e.stopPropagation();
            void removeRoot(root.id);
          }}
        >
          <X size={13} />
        </button>
      }
    />
  );
}

function Empty() {
  return <div className="px-2 text-dim">まだありません</div>;
}

// ------------------------------------------------------------ 一覧

function placeTitle(place: Place, roots: Root[]): string {
  if (place.rootId !== null) return roots.find((r) => r.id === place.rootId)?.name ?? "";
  return { all: "すべてのファイル", unsorted: "未整理", missing: "行方不明" }[place.view];
}

function Header() {
  const place = useStore((s) => s.place);
  const roots = useStore((s) => s.roots);
  const count = useStore((s) => s.files.length);
  const scanning = useStore((s) => s.scanning);
  return (
    <div className="shrink-0 border-b border-line px-4 pt-[var(--titlebar)]" {...dragRegion(true)}>
      <div className="flex h-10 items-center gap-3">
        <span className="font-semibold">{placeTitle(place, roots)}</span>
        <span className="text-dim tabular-nums">{count} 件</span>
        <span className="flex-1" />
        {/* 読み込み中の印と［読み直す］は同じ場所に置き、幅も同じにする */}
        <button className="ghost flex w-28 items-center justify-end gap-1.5 rounded-md px-2 py-1 text-dim" onClick={() => runCommand("folder.rescan")} disabled={scanning}>
          <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
          {scanning ? "読み込み中…" : "読み直す"}
        </button>
      </div>
    </div>
  );
}

const COLS = "grid-cols-[minmax(0,3fr)_minmax(0,2fr)_8rem_9rem_minmax(0,1fr)]";
const ROW_H = 28;

function FileList() {
  const files = useStore((s) => s.files);
  const roots = useStore((s) => s.roots);
  const place = useStore((s) => s.place);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: files.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const rootPath = new Map(roots.map((r) => [r.id, r.path]));

  return (
    <>
      <div className={`grid shrink-0 ${COLS} gap-3 border-b border-line px-4 py-1.5 text-[11px] font-semibold text-dim`}>
        {["名前", "場所", "種類", "更新日", "タグ"].map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onClick={() => select(null)}>
        {files.length === 0 ? (
          <EmptyList />
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((row) => {
              const f = files[row.index];
              const root = rootPath.get(f.rootId) ?? "";
              const where = place.rootId === null ? joinPlace(roots, f) : relativeDir(root, f.path);
              const on = f.id === selectedId;
              return (
                <div
                  key={f.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(f.id);
                  }}
                  className={`absolute inset-x-0 grid ${COLS} items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"}`}
                  style={{ top: row.start, height: ROW_H }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <KindIcon ext={f.ext} />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className={`truncate ${on ? "" : "text-dim"}`} title={f.path}>
                    {where}
                  </span>
                  <span className={`truncate ${on ? "" : "text-dim"}`}>{kindLabel(f.ext)}</span>
                  <span className={`tabular-nums ${on ? "" : "text-dim"}`}>{formatDate(f.mtime)}</span>
                  <span />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** 「すべてのファイル」などでは、場所を「登録フォルダ名 › 中のフォルダ」で出す。 */
function joinPlace(roots: Root[], f: FileRow): string {
  const root = roots.find((r) => r.id === f.rootId);
  if (!root) return f.path;
  const dir = relativeDir(root.path, f.path);
  return dir ? `${root.name} › ${dir}` : root.name;
}

function EmptyList() {
  const roots = useStore((s) => s.roots);
  const place = useStore((s) => s.place);
  const scanning = useStore((s) => s.scanning);
  if (roots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-dim">
        <div>フォルダを登録すると、中の PDF・オフィス文書・テキストがここに並びます</div>
        <div className="text-[12px]">ファイルは元の場所に置いたままで、動かしたり書き換えたりしません</div>
        <button className="rounded-md bg-accent-fill px-3 py-1.5 text-white" onClick={() => runCommand("folder.add")}>
          フォルダを登録…
        </button>
      </div>
    );
  }
  const text = scanning ? "読み込んでいます…" : place.view === "missing" ? "行方不明のファイルはありません" : "ファイルはありません";
  return <div className="flex h-full items-center justify-center text-dim">{text}</div>;
}

function KindIcon({ ext }: { ext: string }) {
  const k = kindOf(ext);
  const Icon = k === "excel" ? FileSpreadsheet : k === "powerpoint" ? Presentation : k === "word" ? FileType : FileText;
  return <Icon size={15} className="shrink-0 opacity-80" />;
}

// ------------------------------------------------------------ 詳細パネル

function Details() {
  const file = useStore((s) => s.files.find((f) => f.id === s.selectedId));
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel p-4" {...dragRegion()}>
      <div className="pt-[var(--titlebar)]">
        {!file ? (
          <div className="text-dim">ファイルを選ぶと、プレビュー・タグ・メモ・場所がここに出ます</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="break-all font-semibold">{file.name}</div>
            {file.missing && <div className="rounded-md bg-tonal px-2 py-1 text-on-tonal">行方不明：最後に見た場所にありません</div>}
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5">
              <Field label="種類">{kindLabel(file.ext)}</Field>
              <Field label="大きさ">{formatSize(file.size)}</Field>
              <Field label="更新日">{formatDate(file.mtime)}</Field>
              <Field label="場所">
                <span className="break-all select-text">{file.path}</span>
              </Field>
            </dl>
          </div>
        )}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  );
}

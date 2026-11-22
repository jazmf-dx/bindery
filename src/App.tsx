/**
 * 画面の枠（docs/CONCEPT.md「決めたこと」の画面）。左からサイドバー・リスト・詳細パネルの 3 列。
 * まだデータも操作も無い。表示を切り替えても、この 3 列の位置と幅は変えない
 * （desktop-platform UI Standard「レイアウトの安定」）。
 */
import { useEffect, type ReactNode } from "react";
import { FolderSearch, HelpCircle, Inbox } from "lucide-react";
import { listenCommandKeys } from "./lib/commands";
import { dragRegion } from "./lib/titleBar";
import { scheduleUpdateCheck } from "./lib/update";

export default function App() {
  useEffect(() => {
    const stopKeys = listenCommandKeys();
    const stopUpdate = scheduleUpdateCheck();
    return () => {
      stopKeys();
      stopUpdate();
    };
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="shrink-0 border-b border-line px-4 pt-[var(--titlebar)]" {...dragRegion(true)}>
          <div className="flex h-10 items-center font-semibold">すべてのファイル</div>
        </div>
        <ListHeader />
        <div className="flex flex-1 items-center justify-center text-dim">ファイルはまだありません</div>
      </main>
      <aside className="w-72 shrink-0 border-l border-line bg-panel p-4 text-dim" {...dragRegion()}>
        <div className="pt-[var(--titlebar)]">ファイルを選ぶと、プレビュー・タグ・メモ・場所がここに出ます</div>
      </aside>
    </div>
  );
}

/** 上から 未整理・行方不明 → 仮想フォルダ → タグ → 登録フォルダ。 */
function Sidebar() {
  return (
    <nav className="vibrant flex w-56 shrink-0 flex-col gap-4 border-r border-line bg-panel px-2 pb-3" {...dragRegion(true)}>
      <div className="h-[var(--titlebar)] shrink-0" />
      <Section>
        <Row icon={<Inbox size={15} />} label="未整理" />
        <Row icon={<HelpCircle size={15} />} label="行方不明" />
      </Section>
      <Section title="仮想フォルダ">
        <Empty />
      </Section>
      <Section title="タグ">
        <Empty />
      </Section>
      <Section title="登録フォルダ">
        <Row icon={<FolderSearch size={15} />} label="フォルダを登録…" dim />
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

function Row({ icon, label, dim }: { icon: ReactNode; label: string; dim?: boolean }) {
  return (
    <div className={`ghost flex items-center gap-2 rounded-md px-2 py-1 ${dim ? "text-dim" : ""}`}>
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Empty() {
  return <div className="px-2 text-dim">まだありません</div>;
}

/** リストの列：名前・場所・種類・更新日・タグ。 */
function ListHeader() {
  const cols = ["名前", "場所", "種類", "更新日", "タグ"];
  return (
    <div className="grid shrink-0 grid-cols-[2fr_2fr_6rem_8rem_1fr] gap-3 border-b border-line px-4 py-1.5 text-[11px] font-semibold text-dim">
      {cols.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

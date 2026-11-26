/**
 * 一覧の上のツールバー（docs/CONCEPT.md「ツールバーと表示の切り替え」）。
 * macOS ではタイトルバーと同じ高さの 1 行に、場所の名前・件数・絞り込み・読み直す・表示の切り替え・パネルの開け閉めを置く。
 * サイドバーを隠したときは、ウィンドウのボタンの分だけ左を空ける。
 */
import { useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, LayoutList, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { keyLabel, runCommand, SEARCH_FIELD } from "../lib/commands";
import { composing } from "../lib/ime";
import { dragRegion } from "../lib/titleBar";
import { COLUMNS, hasFilters, SORT_KEYS, type Column, type Layout, type SortKey } from "../lib/view";
import { folderPath, useStore } from "../store";
import { MenuHeading, MenuOption, Popover } from "./ui";

function placeTitle(): string {
  const { place, roots, tags, vfolders } = useStore.getState();
  switch (place.kind) {
    case "all":
      return "すべてのファイル";
    case "unsorted":
      return "未整理";
    case "missing":
      return "行方不明";
    case "recent":
      return "最近の変更";
    case "root":
      return roots.find((r) => r.id === place.id)?.name ?? "";
    case "tag":
      return `タグ：${tags.find((t) => t.id === place.id)?.name ?? ""}`;
    case "folder":
      return folderPath(vfolders, place.id);
  }
}

/**
 * 場所の名前。中のフォルダでは「登録フォルダ › 中 › 中」と出し、上の階層を押すとそこへ移る。
 */
function Title() {
  const place = useStore((s) => s.place);
  const go = useStore((s) => s.go);
  // 場所や名前が変わったときも見出しを変える
  useStore((s) => s.roots);
  useStore((s) => s.tags);
  useStore((s) => s.vfolders);
  if (place.kind !== "root" || !place.dir) return <span className="min-w-0 truncate font-semibold">{placeTitle()}</span>;
  const parts = place.dir.split("/");
  const crumb = (label: string, dir: string) => (
    <button key={dir} className="ghost min-w-0 shrink truncate rounded px-1 text-dim" title={`${label}へ`} onClick={() => go({ kind: "root", id: place.id, dir })}>
      {label}
    </button>
  );
  return (
    <span className="-ml-1 flex min-w-0 items-center gap-0.5 font-semibold">
      {crumb(placeTitle(), "")}
      {parts.slice(0, -1).map((p, i) => (
        <span key={i} className="flex min-w-0 shrink items-center gap-0.5">
          <span className="text-dim">›</span>
          {crumb(p, parts.slice(0, i + 1).join("/"))}
        </span>
      ))}
      <span className="text-dim">›</span>
      <span className="min-w-0 truncate px-1">{parts[parts.length - 1]}</span>
    </span>
  );
}

/** 件数。絞っているときは「絞った数 / 今の場所の数」、複数を選んでいるときはその数も。 */
function Count() {
  const count = useStore((s) => s.files.length);
  const total = useStore((s) => s.allFiles.length);
  const narrowed = useStore((s) => s.query.trim() !== "" || hasFilters(s.filters));
  const selected = useStore((s) => s.selected.length);
  return (
    <span className={`shrink-0 tabular-nums ${narrowed ? "text-accent" : "text-dim"}`}>
      {narrowed ? `${count} / ${total} 件` : `${count} 件`}
      {selected > 1 && <span className="text-dim">（{selected} 件を選択）</span>}
    </span>
  );
}

const iconButton = "ghost flex h-7 w-7 shrink-0 items-center justify-center rounded-md";

export function Toolbar() {
  const scanning = useStore((s) => s.scanning);
  const sidebarOpen = useStore((s) => s.prefs.sidebarOpen);
  const detailsOpen = useStore((s) => s.prefs.detailsOpen);
  return (
    <div
      className="@container flex h-10 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3 transition-[padding] duration-200 ease-out"
      // サイドバーを隠すと、macOS のウィンドウのボタンがこの行に重なる
      style={sidebarOpen ? undefined : { paddingLeft: "max(0.75rem, var(--traffic-lights))" }}
      {...dragRegion(true)}
    >
      <button
        className={`${iconButton} -ml-1 ${sidebarOpen ? "text-dim" : "text-accent"}`}
        title={`サイドバーを${sidebarOpen ? "隠す" : "表示"}（${keyLabel("view.sidebar")}）`}
        aria-label={`サイドバーを${sidebarOpen ? "隠す" : "表示"}`}
        onClick={() => runCommand("view.sidebar")}
      >
        {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
      </button>
      <Title />
      <Count />
      <span className="min-w-2 flex-1" />
      <SearchField />
      {/* 読み込み中の印と［読み直す］は同じ場所に置き、幅も同じにする */}
      <button
        className="ghost flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-dim @max-2xl:w-7 @max-2xl:justify-center @max-2xl:px-0 @2xl:w-[6.5rem] @2xl:justify-end"
        onClick={() => runCommand("folder.rescan")}
        disabled={scanning}
        title={`読み直す（${keyLabel("folder.rescan")}）`}
      >
        <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
        <span className="@max-2xl:hidden">{scanning ? "読み込み中…" : "読み直す"}</span>
      </button>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <LayoutSwitch />
      <DisplayMenu />
      <button
        className={`${iconButton} ${detailsOpen ? "text-dim" : "text-accent"}`}
        title={`詳細パネルを${detailsOpen ? "隠す" : "表示"}（${keyLabel("view.details")}）`}
        aria-label={`詳細パネルを${detailsOpen ? "隠す" : "表示"}`}
        onClick={() => runCommand("view.details")}
      >
        {detailsOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>
    </div>
  );
}

/** 今の場所の中を絞り込む欄。Esc で空にし、空ならやめる。 */
function SearchField() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  return (
    <label className="flex h-7 min-w-28 shrink-[4] basis-60 items-center gap-1.5 rounded-md border border-transparent bg-control px-2 focus-within:border-accent">
      <Search size={13} className="shrink-0 text-dim" />
      <input
        id={SEARCH_FIELD}
        value={query}
        placeholder={`絞り込む（${keyLabel("find")}）`}
        title="名前・場所・タグ・メモで、今の場所の中を絞り込みます"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === "Escape") {
            if (query) setQuery("");
            else e.currentTarget.blur();
            e.stopPropagation();
          }
          // 絞り込んだ一覧へ移る
          if (e.key === "Enter" || e.key === "ArrowDown") {
            e.currentTarget.blur();
            e.preventDefault();
            const st = useStore.getState();
            if (st.selected.length === 0) st.step(1, false);
          }
        }}
        className="w-0 min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim"
      />
      {/* 空のときも場所は取っておく（幅を変えない） */}
      <button aria-label="絞り込みをやめる" title="絞り込みをやめる" className={`ghost rounded p-0.5 text-dim ${query ? "" : "invisible"}`} onClick={() => setQuery("")}>
        <X size={12} />
      </button>
    </label>
  );
}

const LAYOUTS: { key: Layout; label: string; icon: React.ReactNode; command: string }[] = [
  { key: "grid", label: "グリッド", icon: <LayoutGrid size={15} />, command: "view.grid" },
  { key: "list", label: "リスト", icon: <LayoutList size={15} />, command: "view.list" },
];

/** 一覧の形を 1 回で切り替える（Finder と同じ順：グリッド ⌘1・リスト ⌘2）。 */
function LayoutSwitch() {
  const layout = useStore((s) => s.prefs.layout);
  return (
    <div role="group" aria-label="一覧の形" className="flex h-7 shrink-0 items-stretch rounded-md track">
      {LAYOUTS.map((l) => (
        <button
          key={l.key}
          title={`${l.label}（${keyLabel(l.command)}）`}
          aria-label={l.label}
          aria-pressed={layout === l.key}
          onClick={() => runCommand(l.command)}
          className={`flex w-7 items-center justify-center rounded ${layout === l.key ? "thumb" : "text-fg/85 hover:bg-hover hover:text-fg"}`}
        >
          {l.icon}
        </button>
      ))}
    </div>
  );
}

export const SORT_LABEL: Record<SortKey, string> = { name: "名前", place: "場所", kind: "種類", date: "更新日", size: "大きさ" };
export const COLUMN_LABEL: Record<Column, string> = { place: "場所", kind: "種類", date: "更新日", size: "大きさ", tags: "タグ" };

/**
 * 表示のメニュー：並び順（グリッドには列の見出しが無いので、ここで選ぶ）と、リストの列の出し入れ。
 */
function DisplayMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const recent = useStore((s) => s.place.kind === "recent");
  const sort = useStore((s) => (s.place.kind === "recent" ? s.recentSort : s.sort));
  const setSort = useStore((s) => s.setSort);
  const layout = useStore((s) => s.prefs.layout);
  const columns = useStore((s) => s.prefs.columns);
  const toggleColumn = useStore((s) => s.toggleColumn);
  const label = (k: SortKey) => (recent && k === "date" ? "気付いた日" : SORT_LABEL[k]);
  return (
    <>
      <button
        ref={button}
        className={`${iconButton} ${open ? "bg-press" : ""}`}
        title={`表示：${label(sort.key)}の${sort.desc ? "降順" : "昇順"}`}
        aria-label="表示の設定"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} width="w-52">
          <MenuHeading>並び順</MenuHeading>
          {SORT_KEYS.map((k) => (
            <MenuOption key={k} single on={sort.key === k} onClick={() => setSort({ key: k, desc: sort.key === k ? sort.desc : k === "date" || k === "size" })}>
              {label(k)}
            </MenuOption>
          ))}
          <div className="mx-1 my-1 flex gap-0.5 rounded-md track">
            {[false, true].map((desc) => (
              <button
                key={String(desc)}
                aria-pressed={sort.desc === desc}
                onClick={() => setSort({ ...sort, desc })}
                className={`flex flex-1 items-center justify-center gap-1 rounded py-0.5 ${sort.desc === desc ? "thumb" : "text-fg/85 hover:bg-hover"}`}
              >
                {desc ? <ArrowDownWideNarrow size={13} /> : <ArrowUpNarrowWide size={13} />}
                {desc ? "降順" : "昇順"}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-line" />
          <MenuHeading>リストの列{layout === "grid" ? "（リストのとき）" : ""}</MenuHeading>
          <MenuOption on disabled onClick={() => {}}>
            名前
          </MenuOption>
          {COLUMNS.map((c) => (
            <MenuOption key={c} on={columns.includes(c)} onClick={() => toggleColumn(c)}>
              {c === "date" && recent ? "気付いた日" : COLUMN_LABEL[c]}
            </MenuOption>
          ))}
        </Popover>
      )}
    </>
  );
}

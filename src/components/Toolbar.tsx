/**
 * 一覧の上のツールバー（docs/CONCEPT.md「ツールバーと表示の切り替え」）。Stockroom と同じ 2 段。
 * サイドバーを隠したときは、開くボタンを左端に出し、macOS のウィンドウのボタンの分だけ左を空ける。
 */
import { useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, ChevronDown, LayoutGrid, LayoutList, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { keyLabel, runCommand, SEARCH_FIELD } from "../lib/commands";
import { composing } from "../lib/ime";
import { dragRegion } from "../lib/titleBar";
import { COLUMNS, DENSITIES, hasFilters, SORT_KEYS, type Column, type Density, type Layout, type SortKey } from "../lib/view";
import { folderPath, useStore } from "../store";
import { FilterRow } from "./FilterRow";
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
    <span className={`shrink-0 text-[12px] font-normal tabular-nums ${narrowed ? "text-accent" : "text-dim"}`}>
      {narrowed ? `${count} / ${total} 件` : `${count} 件`}
      {selected > 1 && <span className="text-dim">（{selected} 件を選択）</span>}
    </span>
  );
}

const iconButton = "ghost flex h-8 w-8 shrink-0 items-center justify-center rounded-md";

/**
 * stockroom の Toolbar.tsx と同じ形：上の行に（サイドバーを隠しているときは開くボタン）・場所の名前と件数・絞り込み・読み直す・詳細パネルの開け閉め、
 * 下の帯（FilterRow.tsx）に条件と、右端に並び順・一覧の形・表示のメニュー。
 */
export function Toolbar() {
  const scanning = useStore((s) => s.scanning);
  const sidebarOpen = useStore((s) => s.prefs.sidebarOpen);
  const detailsOpen = useStore((s) => s.prefs.detailsOpen);
  return (
    <header
      className="@container flex shrink-0 flex-col gap-2 border-b border-line bg-panel px-4 pt-2 transition-[padding] duration-200 ease-out"
      // サイドバーを隠すと、macOS のウィンドウのボタンがこの行に重なる
      style={sidebarOpen ? undefined : { paddingLeft: "max(1rem, var(--traffic-lights))" }}
      {...dragRegion(true)}
    >
      <div className="flex h-8 items-center gap-2">
        {/* 隠すボタンはサイドバーの上端にある（Sidebar.tsx）。閉じているあいだだけ、開くボタンをここに出す（stockroom と同じ） */}
        {!sidebarOpen && (
          <button
            className={`${iconButton} -ml-1 text-accent`}
            title={`サイドバーを表示（${keyLabel("view.sidebar")}）`}
            aria-label="サイドバーを表示"
            onClick={() => runCommand("view.sidebar")}
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        <h1 className="flex min-w-0 items-baseline gap-2 text-[15px]">
          <Title />
          <Count />
        </h1>
        <span className="min-w-2 flex-1" />
        <SearchField />
        {/* 読み込み中の印と［読み直す］は同じ場所に置き、幅も同じにする */}
        <button
          className="ghost flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-dim @max-2xl:w-8 @max-2xl:justify-center @max-2xl:px-0 @2xl:w-[7.5rem] @2xl:justify-end whitespace-nowrap"
          onClick={() => runCommand("folder.rescan")}
          disabled={scanning}
          title={`読み直す（${keyLabel("folder.rescan")}）`}
        >
          <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
          <span className="@max-2xl:hidden">{scanning ? "読み込み中…" : "読み直す"}</span>
        </button>
        <button
          className={`${iconButton} ${detailsOpen ? "text-dim" : "text-accent"}`}
          title={`詳細パネルを${detailsOpen ? "隠す" : "表示"}（${keyLabel("view.details")}）`}
          aria-label={`詳細パネルを${detailsOpen ? "隠す" : "表示"}`}
          onClick={() => runCommand("view.details")}
        >
          {detailsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
      <FilterRow display={<DisplayControls />} />
    </header>
  );
}

/** 今の場所の中を絞り込む欄。Esc で空にし、空ならやめる。 */
function SearchField() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  return (
    <label className="flex h-8 min-w-28 shrink-[4] basis-60 items-center gap-2 rounded-md border border-transparent bg-ink/7 px-2 focus-within:border-accent">
      <Search size={14} className="shrink-0 text-dim" />
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
 * 帯の右端の、一覧の見せ方（stockroom の DisplayControls と同じ並び）：並び順と向き・一覧の形・表示のメニュー。
 */
function DisplayControls() {
  const recent = useStore((s) => s.place.kind === "recent");
  const sort = useStore((s) => (s.place.kind === "recent" ? s.recentSort : s.sort));
  const setSort = useStore((s) => s.setSort);
  const label = (k: SortKey) => (recent && k === "date" ? "気付いた日" : SORT_LABEL[k]);
  return (
    <>
      <div className="flex h-7 shrink-0 items-stretch gap-0.5">
        {/* OS の select を、今の選択の名前の上に重ねる（名前が切れず、矢印も画面とそろう） */}
        <label title={`並び順：${label(sort.key)}`} className="relative flex items-center gap-1.5 rounded-md pr-2 pl-2.5 whitespace-nowrap hover:bg-hover focus-within:ring-2 focus-within:ring-accent">
          <ArrowUpDown size={13} className="text-dim" />
          <span>{label(sort.key)}</span>
          <ChevronDown size={13} className="text-dim" />
          <select
            aria-label="並び順"
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSort({ key, desc: key === "date" || key === "size" });
            }}
            className="absolute inset-0 cursor-default opacity-0"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <button
          title={sort.desc ? "降順（押すと昇順）" : "昇順（押すと降順）"}
          aria-label={sort.desc ? "降順" : "昇順"}
          onClick={() => setSort({ ...sort, desc: !sort.desc })}
          className="flex w-7 items-center justify-center rounded-md hover:bg-hover active:bg-press"
        >
          {sort.desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
        </button>
      </div>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <LayoutSwitch />
      <DisplayMenu />
    </>
  );
}

/** 表示のメニュー：リストの見た目（行の高さ・線・1 行おきの色）と、列の出し入れ。グリッドのときは押せない。 */
function DisplayMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const recent = useStore((s) => s.place.kind === "recent");
  const grid = useStore((s) => s.prefs.layout === "grid");
  const prefs = useStore((s) => s.prefs);
  const toggleColumn = useStore((s) => s.toggleColumn);
  const setListLook = useStore((s) => s.setListLook);
  return (
    <>
      <button
        ref={button}
        className={`ghost flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${open ? "bg-press" : ""}`}
        title="表示（リストの見た目と列）"
        aria-label="表示の設定"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <Popover anchor={button.current} onClose={() => setOpen(false)} width="w-60">
          {grid && <div className="px-2 pt-1.5 pb-1 text-[11px] text-dim">リストにしたときの見た目です</div>}
          <MenuHeading>行の高さ</MenuHeading>
          <div role="group" aria-label="行の高さ" className="mx-1 mb-1 flex gap-0.5 rounded-md track">
            {DENSITIES.map((d) => (
              <button
                key={d}
                aria-pressed={prefs.density === d}
                onClick={() => setListLook({ density: d })}
                className={`flex-1 rounded py-0.5 ${prefs.density === d ? "thumb" : "text-fg/85 hover:bg-hover"}`}
              >
                {DENSITY_LABEL[d]}
              </button>
            ))}
          </div>
          <MenuOption on={prefs.rowLines} onClick={() => setListLook({ rowLines: !prefs.rowLines })}>
            行を線で区切る
          </MenuOption>
          <MenuOption on={prefs.stripes} onClick={() => setListLook({ stripes: !prefs.stripes })}>
            1 行おきに色を付ける
          </MenuOption>
          <div className="my-1 h-px bg-line" />
          <MenuHeading>列</MenuHeading>
          <MenuOption on disabled onClick={() => {}}>
            名前
          </MenuOption>
          {COLUMNS.map((c) => (
            <MenuOption key={c} on={prefs.columns.includes(c)} onClick={() => toggleColumn(c)}>
              {c === "date" && recent ? "気付いた日" : COLUMN_LABEL[c]}
            </MenuOption>
          ))}
        </Popover>
      )}
    </>
  );
}

const DENSITY_LABEL: Record<Density, string> = { compact: "詰める", normal: "標準", relaxed: "ゆったり" };

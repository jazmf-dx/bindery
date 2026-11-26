/**
 * 一覧（リストだけ。docs/CONCEPT.md「一覧」）。名前・場所・種類・更新日・タグの列。
 * 選ぶ：クリック、⌘/Ctrl クリックで足す・外す、Shift クリックで範囲。ダブルクリックで開く。
 * 行をドラッグして、サイドバーの仮想フォルダ・タグへ落とせる（DragLayer.tsx）。
 * 見出しの上の欄で、今の場所の中を絞り込む。その下の条件の行で、タグ・種類・更新日で絞る。
 * 列の見出しを押すと並べ替える（docs/CONCEPT.md「探す」「条件の組み合わせ」）。
 * 行を右クリックすると OS のメニューを出す（contextMenu.ts）。
 * 登録フォルダ・中のフォルダを開いているときは、先頭に中のフォルダの行を出す（ダブルクリック・Enter で入る、⌘↑ で上へ）。
 */
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, RefreshCw, Search, StickyNote, Tag as TagIcon, X } from "lucide-react";
import type { FileRow, Root } from "../lib/api";
import { keyLabel, runCommand, SEARCH_FIELD } from "../lib/commands";
import { cmd, openMenu, type Entry } from "../lib/contextMenu";
import { composing } from "../lib/ime";
import { formatDate, kindLabel, kindName, KINDS, relativeDir, type Kind } from "../lib/kinds";
import { dragRegion } from "../lib/titleBar";
import { hasFilters, NO_FILTERS, type SortKey, type SubDir, type Within } from "../lib/view";
import { folderPath, useStore } from "../store";
import { FolderIcon, KindIcon } from "./KindIcon";
import { rootMenu } from "./Sidebar";

const isMac = navigator.userAgent.includes("Mac");
const COLS = "grid-cols-[minmax(0,3fr)_minmax(0,2fr)_8rem_10.5rem_minmax(0,1.5fr)]";
const ROW_H = 28;

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
 * 見出しの場所の名前。中のフォルダでは「登録フォルダ › 中 › 中」と出し、上の階層を押すとそこへ移る。
 */
function Title() {
  const place = useStore((s) => s.place);
  const go = useStore((s) => s.go);
  if (place.kind !== "root" || !place.dir) return <span className="truncate font-semibold">{placeTitle()}</span>;
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

export function Header() {
  // 場所や名前が変わったときも見出しを変える
  useStore((s) => s.place);
  useStore((s) => s.roots);
  useStore((s) => s.tags);
  useStore((s) => s.vfolders);
  const count = useStore((s) => s.files.length);
  const total = useStore((s) => s.allFiles.length);
  const narrowed = useStore((s) => s.query.trim() !== "" || hasFilters(s.filters));
  const selected = useStore((s) => s.selected.length);
  const scanning = useStore((s) => s.scanning);
  return (
    <div className="shrink-0 border-b border-line px-4 pt-[var(--titlebar)]" {...dragRegion(true)}>
      <div className="flex h-10 items-center gap-3">
        <Title />
        <span className="shrink-0 text-dim tabular-nums">
          {narrowed ? `${count} / ${total} 件` : `${count} 件`}
          {selected > 1 ? `（${selected} 件を選択）` : ""}
        </span>
        <span className="flex-1" />
        <SearchField />
        {/* 読み込み中の印と［読み直す］は同じ場所に置き、幅も同じにする */}
        <button className="ghost flex w-28 shrink-0 items-center justify-end gap-1.5 rounded-md px-2 py-1 text-dim" onClick={() => runCommand("folder.rescan")} disabled={scanning}>
          <RefreshCw size={13} className={scanning ? "animate-spin" : ""} />
          {scanning ? "読み込み中…" : "読み直す"}
        </button>
      </div>
    </div>
  );
}

/** 今の場所の中を絞り込む欄。Esc で空にし、空ならやめる。 */
function SearchField() {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  return (
    <label className="flex w-56 shrink-0 items-center gap-1.5 rounded-md border border-edge bg-field px-2 py-0.5 focus-within:border-accent">
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
        className="min-w-0 flex-1 bg-transparent py-0.5 outline-none"
      />
      {query && (
        <button aria-label="絞り込みをやめる" title="絞り込みをやめる" className="ghost rounded p-0.5 text-dim" onClick={() => setQuery("")}>
          <X size={12} />
        </button>
      )}
    </label>
  );
}

const WITHIN: { value: Within; label: string }[] = [
  { value: "today", label: "今日" },
  { value: 7, label: "7 日以内" },
  { value: 30, label: "30 日以内" },
  { value: 365, label: "1 年以内" },
];

/**
 * 条件の行：タグ（すべて付いているもの）・種類・更新日で、今の場所の中を絞る（docs/CONCEPT.md「条件の組み合わせ」）。
 * 条件が無いときも同じ高さで出す（一覧の位置を変えない）。
 */
export function ConditionBar() {
  const filters = useStore((s) => s.filters);
  const tags = useStore((s) => s.tags);
  const setFilters = useStore((s) => s.setFilters);
  const chosen = tags.filter((t) => filters.tags.includes(t.id));
  const left = tags.filter((t) => !filters.tags.includes(t.id));
  const select = "rounded-md border border-edge bg-field px-1.5 py-0.5 outline-none focus:border-accent";
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-line px-4 text-[12px]">
      <span className="shrink-0 text-dim">条件</span>
      {chosen.map((t) => (
        <span key={t.id} className="flex shrink-0 items-center gap-1 rounded-md bg-control py-0.5 pr-0.5 pl-1.5">
          <TagIcon size={11} />
          {t.name}
          <button aria-label={`タグ「${t.name}」の条件を外す`} className="ghost rounded p-0.5" onClick={() => setFilters({ ...filters, tags: filters.tags.filter((id) => id !== t.id) })}>
            <X size={11} />
          </button>
        </span>
      ))}
      <select
        aria-label="タグの条件を足す"
        value=""
        disabled={left.length === 0}
        onChange={(e) => e.target.value && setFilters({ ...filters, tags: [...filters.tags, Number(e.target.value)] })}
        className={`${select} shrink-0 disabled:off`}
      >
        <option value="">{chosen.length ? "＋ かつ タグ…" : "タグ…"}</option>
        {left.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        aria-label="種類の条件"
        value={filters.kind ?? ""}
        onChange={(e) => setFilters({ ...filters, kind: (e.target.value || null) as Kind | null })}
        className={`${select} shrink-0 ${filters.kind ? "border-accent" : ""}`}
      >
        <option value="">すべての種類</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {kindName(k)}
          </option>
        ))}
      </select>
      <select
        aria-label="更新日の条件"
        value={filters.within ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          setFilters({ ...filters, within: v === "" ? null : v === "today" ? "today" : (Number(v) as Within) });
        }}
        className={`${select} shrink-0 ${filters.within !== null ? "border-accent" : ""}`}
      >
        <option value="">いつ更新したものでも</option>
        {WITHIN.map((w) => (
          <option key={w.value} value={w.value}>
            更新日が{w.label}
          </option>
        ))}
      </select>
      <span className="flex-1" />
      {hasFilters(filters) && (
        <button className="ghost shrink-0 rounded px-1.5 py-0.5 text-dim" onClick={() => setFilters(NO_FILTERS)}>
          条件を外す
        </button>
      )}
    </div>
  );
}

const COLUMNS: { label: string; key?: SortKey }[] = [
  { label: "名前", key: "name" },
  { label: "場所", key: "place" },
  { label: "種類", key: "kind" },
  { label: "更新日", key: "date" },
  { label: "タグ" },
];

/** 列の見出し。押すと並べ替える（同じ列をもう一度押すと逆に）。 */
function ColumnHeads() {
  const recent = useStore((s) => s.place.kind === "recent");
  const sort = useStore((s) => (s.place.kind === "recent" ? s.recentSort : s.sort));
  const sortBy = useStore((s) => s.sortBy);
  return (
    <div className={`grid shrink-0 ${COLS} gap-3 border-b border-line px-4 py-1 text-[11px] font-semibold text-dim`}>
      {COLUMNS.map((c) => {
        // 「最近の変更」では、日付の列は気付いた日
        const label = recent && c.key === "date" ? "気付いた日" : c.label;
        if (!c.key) return <span key={c.label} className="py-0.5">{label}</span>;
        const on = sort.key === c.key;
        const Arrow = sort.desc ? ArrowDown : ArrowUp;
        return (
          <button
            key={c.label}
            className="ghost -mx-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left"
            title={`${label}で並べ替える`}
            onClick={() => sortBy(c.key!)}
          >
            <span className={`truncate ${on ? "text-fg" : ""}`}>{label}</span>
            {on && <Arrow size={11} className="shrink-0 text-fg" />}
          </button>
        );
      })}
    </div>
  );
}

export function FileList() {
  const files = useStore((s) => s.files);
  const subdirs = useStore((s) => s.subdirs);
  const dirFocus = useStore((s) => s.dirFocus);
  const roots = useStore((s) => s.roots);
  const tags = useStore((s) => s.tags);
  const place = useStore((s) => s.place);
  const selected = useStore((s) => s.selected);
  const scroller = useRef<HTMLDivElement>(null);
  // 行は、先頭のフォルダの行に続けてファイルの行
  const v = useVirtualizer({ count: subdirs.length + files.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const chosen = new Set(selected);
  const root = place.kind === "root" ? roots.find((r) => r.id === place.id) : undefined;

  // 矢印キーで選んだ行が見えるように
  const last = selected[selected.length - 1];
  useEffect(() => {
    const i = dirFocus !== null ? subdirs.findIndex((d) => d.path === dirFocus) : last === undefined ? -1 : subdirs.length + files.findIndex((f) => f.id === last);
    if (i >= 0 && (dirFocus !== null || i >= subdirs.length)) v.scrollToIndex(i, { align: "auto" });
  }, [last, dirFocus, files, subdirs, v]);

  return (
    <>
      <ColumnHeads />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}>
        {files.length + subdirs.length === 0 ? (
          <EmptyList />
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((row) => {
              if (row.index < subdirs.length) {
                const d = subdirs[row.index];
                return <DirLine key={`dir:${d.path}`} dir={d} top={row.start} on={dirFocus === d.path} where={place.kind === "root" ? place.dir : ""} rootId={root?.id ?? 0} />;
              }
              const f = files[row.index - subdirs.length];
              return (
                <FileLine
                  key={f.id}
                  file={f}
                  top={row.start}
                  on={chosen.has(f.id)}
                  recent={place.kind === "recent"}
                  where={place.kind === "root" ? relativeDir(root?.path ?? "", f.path) : joinPlace(roots, f)}
                  tagNames={f.tags.map((id) => tagName.get(id) ?? "").filter(Boolean)}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function FileLine({ file: f, top, on, recent, where, tagNames }: { file: FileRow; top: number; on: boolean; recent: boolean; where: string; tagNames: string[] }) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const toggle = isMac ? e.metaKey : e.ctrlKey;
        const st = useStore.getState();
        // 選んである行を押したときは、ドラッグかもしれないので、離したときに選び直す
        if (!(on && !toggle && !e.shiftKey)) st.click(f.id, { shift: e.shiftKey, toggle });
        startDrag(e.clientX, e.clientY, f.id, on && !toggle && !e.shiftKey);
      }}
      onDoubleClick={() => runCommand("file.open")}
      onContextMenu={(e) => {
        // 選んでいない行なら、その行を選んでから（Finder と同じ）
        const st = useStore.getState();
        if (!st.selected.includes(f.id)) st.click(f.id, { shift: false, toggle: false });
        openMenu(e, fileMenu);
      }}
      className={`absolute inset-x-0 grid ${COLS} items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"} ${f.missing ? "opacity-60" : ""}`}
      style={{ top, height: ROW_H }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <KindIcon ext={f.ext} on={on} />
        <span className="truncate">{f.name}</span>
        {f.note && (
          <span className={`shrink-0 ${on ? "" : "text-dim"}`} title={f.note}>
            <StickyNote size={12} aria-label="メモあり" />
          </span>
        )}
      </span>
      <span className={`truncate ${on ? "" : "text-dim"}`} title={f.path}>
        {f.missing ? "（行方不明）" : where}
      </span>
      <span className={`truncate ${on ? "" : "text-dim"}`}>{kindLabel(f.ext)}</span>
      {recent ? (
        <span className={`flex min-w-0 items-center gap-1.5 tabular-nums ${on ? "" : "text-dim"}`} title={`更新日：${formatDate(f.mtime)}`}>
          <ChangeBadge change={f.change} on={on} />
          <span className="truncate">{formatDate(f.changedAt ?? 0)}</span>
        </span>
      ) : (
        <span className={`tabular-nums ${on ? "" : "text-dim"}`}>{formatDate(f.mtime)}</span>
      )}
      <span className="flex min-w-0 gap-1 overflow-hidden">
        {tagNames.map((n) => (
          <span key={n} className={`shrink-0 rounded px-1.5 text-[11px] ${on ? "bg-white/20" : "bg-control"}`}>
            {n}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 中のフォルダの行。ダブルクリックで入る。列は名前（と中のファイルの数）・場所・種類だけ。 */
function DirLine({ dir, top, on, where, rootId }: { dir: SubDir; top: number; on: boolean; where: string; rootId: number }) {
  const dim = on ? "" : "text-dim";
  return (
    <div
      onMouseDown={(e) => e.button === 0 && useStore.getState().focusDir(dir.path)}
      onDoubleClick={() => useStore.getState().enterDir(dir.path)}
      onContextMenu={(e) => {
        const st = useStore.getState();
        st.focusDir(dir.path);
        const root = st.roots.find((r) => r.id === rootId);
        if (root) openMenu(e, () => [{ label: "開く", run: () => st.enterDir(dir.path) }, "-", ...rootMenu(root, dir.path)]);
      }}
      className={`absolute inset-x-0 grid ${COLS} items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"}`}
      style={{ top, height: ROW_H }}
      title={dir.path}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FolderIcon on={on} />
        <span className="truncate">{dir.name}</span>
        <span className={`shrink-0 text-[11px] tabular-nums ${dim}`}>{dir.count} 件</span>
      </span>
      <span className={`truncate ${dim}`}>{where.split("/").join(" › ")}</span>
      <span className={`truncate ${dim}`}>フォルダ</span>
      <span />
      <span />
    </div>
  );
}

/** 一覧の行の右クリックのメニュー（選んでいるファイルに対して）。 */
function fileMenu(): Entry[] {
  const { files, selected, place, tags, vfolders, setTag, setFolder } = useStore.getState();
  const chosen = files.filter((f) => selected.includes(f.id));
  if (chosen.length === 0) return [];
  const ids = chosen.map((f) => f.id);
  const allMissing = chosen.every((f) => f.missing);
  const onAll = (key: "tags" | "folders", id: number) => chosen.every((f) => f[key].includes(id));
  const here =
    place.kind === "tag"
      ? `タグ「${tags.find((t) => t.id === place.id)?.name ?? ""}」を外す`
      : place.kind === "folder"
        ? `仮想フォルダ「${folderPath(vfolders, place.id)}」から外す`
        : null;
  return [
    cmd("file.open", !allMissing),
    cmd("file.quickLook", !allMissing),
    cmd("file.reveal", !allMissing && chosen.length === 1),
    cmd("file.copyPath"),
    "-",
    {
      label: "タグを付ける",
      items: tags.filter((t) => !onAll("tags", t.id)).map((t) => ({ label: t.name, run: () => void setTag(ids, t.id, true) })),
    },
    {
      label: "仮想フォルダに入れる",
      items: vfolders
        .filter((v) => !onAll("folders", v.id))
        .map((v) => ({ id: v.id, path: folderPath(vfolders, v.id) }))
        .sort((a, b) => a.path.localeCompare(b.path, "ja"))
        .map((v) => ({ label: v.path, run: () => void setFolder(ids, v.id, true) })),
    },
    ...(here ? [{ label: here, run: () => runCommand("file.removeFromPlace") }] : []),
    ...(allMissing ? ["-" as const, cmd("file.relink", chosen.length === 1), cmd("file.forget")] : []),
  ];
}

/** 「最近の変更」の行の印：新規（新しく増えた）／更新（中身が変わった）。 */
function ChangeBadge({ change, on }: { change: FileRow["change"]; on: boolean }) {
  if (!change) return null;
  const isNew = change === "new";
  const tone = on ? "bg-white/20" : isNew ? "bg-tonal text-on-tonal" : "bg-control text-fg";
  return <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${tone}`}>{isNew ? "新規" : "更新"}</span>;
}

/**
 * 押したまま 4px 動いたらドラッグを始める（ブラウザのドラッグ＆ドロップは使わない：
 * Tauri はファイルのドロップを受けるため、Windows ではページの中のドラッグが届かない）。
 * 動かさずに離したら、押した行だけを選び直す（`reselect`）。
 */
function startDrag(x0: number, y0: number, id: number, reselect: boolean) {
  const move = (e: MouseEvent) => {
    if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
    stop();
    const st = useStore.getState();
    const ids = st.selected.length ? st.selected : [id];
    const first = st.files.find((f) => f.id === ids[0]);
    st.setDrag({ ids, x: e.clientX, y: e.clientY, label: ids.length > 1 ? `${ids.length} 件` : (first?.name ?? "") });
  };
  const up = () => {
    stop();
    if (reselect) useStore.getState().click(id, { shift: false, toggle: false });
  };
  const stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
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
  const query = useStore((s) => s.query);
  const filters = useStore((s) => s.filters);
  const total = useStore((s) => s.allFiles.length);
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
  if ((query.trim() || hasFilters(filters)) && total > 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-dim">
        <div>{query.trim() ? `「${query.trim()}」と条件に合うファイルは、ここにはありません` : "条件に合うファイルは、ここにはありません"}</div>
        <div className="text-[12px]">今の場所の中を絞り込んでいます。全体から探すには「すべてのファイル」で</div>
      </div>
    );
  }
  const text = scanning
    ? "読み込んでいます…"
    : {
        all: "ファイルはありません",
        unsorted: "未整理のファイルはありません",
        missing: "行方不明のファイルはありません",
        recent: "この 7 日のあいだに、中身が変わったファイル・増えたファイルはありません。起動したときと［読み直す］で気付きます",
        root: "このフォルダには、扱うファイル（PDF・オフィス文書・テキスト）がありません",
        tag: "このタグのファイルはありません。一覧から行をこのタグへドラッグすると付きます",
        folder: "この仮想フォルダは空です。一覧から行をここへドラッグすると入ります",
      }[place.kind];
  return <div className="flex h-full items-center justify-center px-6 text-center text-dim">{text}</div>;
}

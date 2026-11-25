/**
 * 一覧（リストだけ。docs/CONCEPT.md「一覧」）。名前・場所・種類・更新日・タグの列。
 * 選ぶ：クリック、⌘/Ctrl クリックで足す・外す、Shift クリックで範囲。ダブルクリックで開く。
 * 行をドラッグして、サイドバーの仮想フォルダ・タグへ落とせる（DragLayer.tsx）。
 * 見出しの上の欄で、今の場所の中を絞り込む。列の見出しを押すと並べ替える（docs/CONCEPT.md「探す」）。
 */
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, FileSpreadsheet, FileText, FileType, Presentation, RefreshCw, Search, StickyNote, X } from "lucide-react";
import type { FileRow, Root } from "../lib/api";
import { keyLabel, runCommand, SEARCH_FIELD } from "../lib/commands";
import { composing } from "../lib/ime";
import { formatDate, kindLabel, kindOf, relativeDir } from "../lib/kinds";
import { dragRegion } from "../lib/titleBar";
import type { SortKey } from "../lib/view";
import { folderPath, useStore } from "../store";

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
    case "root": {
      const name = roots.find((r) => r.id === place.id)?.name ?? "";
      return place.dir ? `${name} › ${place.dir.split("/").join(" › ")}` : name;
    }
    case "tag":
      return `タグ：${tags.find((t) => t.id === place.id)?.name ?? ""}`;
    case "folder":
      return folderPath(vfolders, place.id);
  }
}

export function Header() {
  // 場所や名前が変わったときも見出しを変える
  useStore((s) => s.place);
  useStore((s) => s.roots);
  useStore((s) => s.tags);
  useStore((s) => s.vfolders);
  const count = useStore((s) => s.files.length);
  const total = useStore((s) => s.allFiles.length);
  const query = useStore((s) => s.query);
  const selected = useStore((s) => s.selected.length);
  const scanning = useStore((s) => s.scanning);
  return (
    <div className="shrink-0 border-b border-line px-4 pt-[var(--titlebar)]" {...dragRegion(true)}>
      <div className="flex h-10 items-center gap-3">
        <span className="truncate font-semibold">{placeTitle()}</span>
        <span className="shrink-0 text-dim tabular-nums">
          {query.trim() ? `${count} / ${total} 件` : `${count} 件`}
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
  const roots = useStore((s) => s.roots);
  const tags = useStore((s) => s.tags);
  const place = useStore((s) => s.place);
  const selected = useStore((s) => s.selected);
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: files.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const chosen = new Set(selected);

  // 矢印キーで選んだ行が見えるように
  const last = selected[selected.length - 1];
  useEffect(() => {
    if (last === undefined) return;
    const i = files.findIndex((f) => f.id === last);
    if (i >= 0) v.scrollToIndex(i, { align: "auto" });
  }, [last, files, v]);

  return (
    <>
      <ColumnHeads />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}>
        {files.length === 0 ? (
          <EmptyList />
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((row) => {
              const f = files[row.index];
              return (
                <FileLine
                  key={f.id}
                  file={f}
                  top={row.start}
                  on={chosen.has(f.id)}
                  recent={place.kind === "recent"}
                  where={place.kind === "root" ? relativeDir(roots.find((r) => r.id === f.rootId)?.path ?? "", f.path) : joinPlace(roots, f)}
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
      className={`absolute inset-x-0 grid ${COLS} items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"} ${f.missing ? "opacity-60" : ""}`}
      style={{ top, height: ROW_H }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <KindIcon ext={f.ext} />
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
  if (query.trim() && total > 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-dim">
        <div>「{query.trim()}」に合うファイルは、ここにはありません</div>
        <div className="text-[12px]">名前・場所・タグ・メモで、今の場所の中を絞り込んでいます。全体から探すには「すべてのファイル」で</div>
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
        root: "このフォルダに直接入っているファイルはありません。中のフォルダは、サイドバーの ▸ で開けます",
        tag: "このタグのファイルはありません。一覧から行をこのタグへドラッグすると付きます",
        folder: "この仮想フォルダは空です。一覧から行をここへドラッグすると入ります",
      }[place.kind];
  return <div className="flex h-full items-center justify-center px-6 text-center text-dim">{text}</div>;
}

export function KindIcon({ ext }: { ext: string }) {
  const k = kindOf(ext);
  const Icon = k === "excel" ? FileSpreadsheet : k === "powerpoint" ? Presentation : k === "word" ? FileType : FileText;
  return <Icon size={15} className="shrink-0 opacity-80" />;
}


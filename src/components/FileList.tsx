/**
 * 一覧（リストだけ。docs/CONCEPT.md「一覧」）。名前・場所・種類・更新日・タグの列。
 * 選ぶ：クリック、⌘/Ctrl クリックで足す・外す、Shift クリックで範囲。ダブルクリックで開く。
 * 行をドラッグして、サイドバーの仮想フォルダ・タグへ落とせる（DragLayer.tsx）。
 * 見出しの上の欄で、今の場所の中を絞り込む。その下の条件の行で、タグ・種類・更新日で絞る。
 * 列の見出しを押すと並べ替える（docs/CONCEPT.md「探す」「条件の組み合わせ」）。
 * 行を右クリックすると OS のメニューを出す（contextMenu.ts）。
 * 登録フォルダ・中のフォルダを開いているときは、先頭に中のフォルダの行を出す（ダブルクリック・Enter で入る、⌘↑ で上へ）。
 */
/**
 * 一覧（docs/CONCEPT.md「一覧」「ツールバーと表示の切り替え」）。リストとグリッドを切り替える。
 * リストは名前と、表示のメニューで選んだ列（場所・種類・更新日・大きさ・タグ）。グリッドは FileGrid.tsx。
 * 選ぶ：クリック、⌘/Ctrl クリックで足す・外す、Shift クリックで範囲。ダブルクリックで開く。
 * 行をドラッグして、サイドバーの仮想フォルダ・タグへ落とせる（DragLayer.tsx）。
 * 列の見出しを押すと並べ替える（docs/CONCEPT.md「探す」）。
 * 行を右クリックすると OS のメニューを出す（contextMenu.ts）。
 * 登録フォルダ・中のフォルダを開いているときは、先頭に中のフォルダの行を出す（ダブルクリック・Enter で入る、⌘↑ で上へ）。
 */
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, StickyNote } from "lucide-react";
import type { FileRow, Root } from "../lib/api";
import { runCommand } from "../lib/commands";
import { cmd, openMenu, type Entry } from "../lib/contextMenu";
import { formatDate, formatSize, kindLabel, relativeDir } from "../lib/kinds";
import { hasFilters, type Column, type SortKey, type SubDir } from "../lib/view";
import { folderPath, useStore } from "../store";
import { FileGrid } from "./FileGrid";
import { FolderIcon, KindIcon } from "./KindIcon";
import { rootMenu } from "./Sidebar";
import { COLUMN_LABEL } from "./Toolbar";

const isMac = navigator.userAgent.includes("Mac");
const ROW_H = 28;

/** 列の幅。名前の列はいつも先頭に出す。 */
const WIDTH: Record<"name" | Column, string> = {
  name: "minmax(0,3fr)",
  place: "minmax(0,2fr)",
  kind: "8rem",
  date: "10.5rem",
  size: "5.5rem",
  tags: "minmax(0,1.5fr)",
};

const SORT_OF: Partial<Record<Column, SortKey>> = { place: "place", kind: "kind", date: "date", size: "size" };

/** 出す列（名前のあと。表示のメニューで選んだもの）と、その grid の幅の指定。 */
function useColumns(): { columns: Column[]; template: string } {
  const columns = useStore((s) => s.prefs.columns);
  return { columns, template: ["name" as const, ...columns].map((c) => WIDTH[c]).join(" ") };
}

/** 列の見出し。押すと並べ替える（同じ列をもう一度押すと逆に）。 */
function ColumnHeads({ columns, template }: { columns: Column[]; template: string }) {
  const recent = useStore((s) => s.place.kind === "recent");
  const sort = useStore((s) => (s.place.kind === "recent" ? s.recentSort : s.sort));
  const sortBy = useStore((s) => s.sortBy);
  const head = (label: string, key: SortKey | undefined, right = false) => {
    if (!key) return <span key={label} className="truncate py-0.5">{label}</span>;
    const on = sort.key === key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <button
        key={label}
        className={`ghost -mx-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 ${right ? "flex-row-reverse text-right" : "text-left"}`}
        title={`${label}で並べ替える`}
        onClick={() => sortBy(key)}
      >
        <span className={`truncate ${on ? "text-fg" : ""}`}>{label}</span>
        {on && <Arrow size={11} className="shrink-0 text-fg" />}
      </button>
    );
  };
  return (
    <div className="grid shrink-0 gap-3 border-b border-line px-4 py-1 text-[11px] font-semibold text-dim" style={{ gridTemplateColumns: template }}>
      {head("名前", "name")}
      {/* 「最近の変更」では、日付の列は気付いた日 */}
      {columns.map((c) => head(recent && c === "date" ? "気付いた日" : COLUMN_LABEL[c], SORT_OF[c], c === "size"))}
    </div>
  );
}

export function FileList() {
  const layout = useStore((s) => s.prefs.layout);
  const empty = useStore((s) => s.files.length + s.subdirs.length === 0);
  if (layout === "grid")
    return empty ? (
      <div className="min-h-0 flex-1">
        <EmptyList />
      </div>
    ) : (
      <FileGrid />
    );
  return <ListView empty={empty} />;
}

function ListView({ empty }: { empty: boolean }) {
  const files = useStore((s) => s.files);
  const subdirs = useStore((s) => s.subdirs);
  const dirFocus = useStore((s) => s.dirFocus);
  const roots = useStore((s) => s.roots);
  const tags = useStore((s) => s.tags);
  const place = useStore((s) => s.place);
  const selected = useStore((s) => s.selected);
  const { columns, template } = useColumns();
  const scroller = useRef<HTMLDivElement>(null);
  // 行は、先頭のフォルダの行に続けてファイルの行
  const v = useVirtualizer({ count: subdirs.length + files.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const chosen = new Set(selected);
  const root = place.kind === "root" ? roots.find((r) => r.id === place.id) : undefined;

  // 矢印キーで選んだ行が見えるように
  const last = selected[selected.length - 1];
  useEffect(() => {
    const i = focusIndex(subdirs, files, dirFocus, last);
    if (i >= 0) v.scrollToIndex(i, { align: "auto" });
  }, [last, dirFocus, files, subdirs, v]);

  return (
    <>
      <ColumnHeads columns={columns} template={template} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}>
        {empty ? (
          <EmptyList />
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((row) => {
              if (row.index < subdirs.length) {
                const d = subdirs[row.index];
                return (
                  <DirLine
                    key={`dir:${d.path}`}
                    dir={d}
                    top={row.start}
                    on={dirFocus === d.path}
                    where={place.kind === "root" ? place.dir : ""}
                    rootId={root?.id ?? 0}
                    columns={columns}
                    template={template}
                  />
                );
              }
              const f = files[row.index - subdirs.length];
              return (
                <FileLine
                  key={f.id}
                  file={f}
                  top={row.start}
                  on={chosen.has(f.id)}
                  recent={place.kind === "recent"}
                  where={placeOf(roots, place.kind === "root" ? root : undefined, f)}
                  tagNames={f.tags.map((id) => tagName.get(id) ?? "").filter(Boolean)}
                  columns={columns}
                  template={template}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** 選んでいる行（フォルダの行か、最後に選んだファイル）の、一覧の中の位置。無ければ -1。 */
export function focusIndex(subdirs: SubDir[], files: FileRow[], dirFocus: string | null, last: number | undefined): number {
  if (dirFocus !== null) return subdirs.findIndex((d) => d.path === dirFocus);
  if (last === undefined) return -1;
  const i = files.findIndex((f) => f.id === last);
  return i < 0 ? -1 : subdirs.length + i;
}

/** 場所の欄：登録フォルダを開いているときは中のフォルダだけ、ほかでは「登録フォルダ名 › 中のフォルダ」。 */
export function placeOf(roots: Root[], openRoot: Root | undefined, f: FileRow): string {
  if (f.missing) return "（行方不明）";
  return openRoot ? relativeDir(openRoot.path, f.path) : joinPlace(roots, f);
}

/** ファイルの行・枠を押したとき（リストとグリッドで同じ）。 */
export function pressFile(e: React.MouseEvent, f: FileRow, on: boolean) {
  if (e.button !== 0) return;
  const toggle = isMac ? e.metaKey : e.ctrlKey;
  const st = useStore.getState();
  // 選んである行を押したときは、ドラッグかもしれないので、離したときに選び直す
  if (!(on && !toggle && !e.shiftKey)) st.click(f.id, { shift: e.shiftKey, toggle });
  startDrag(e.clientX, e.clientY, f.id, on && !toggle && !e.shiftKey);
}

/** ファイルの行・枠を右クリックしたとき。選んでいない行なら、その行を選んでから（Finder と同じ）。 */
export function fileContextMenu(e: React.MouseEvent, f: FileRow) {
  const st = useStore.getState();
  if (!st.selected.includes(f.id)) st.click(f.id, { shift: false, toggle: false });
  openMenu(e, fileMenu);
}

/** 中のフォルダの行・枠を右クリックしたとき。 */
export function dirContextMenu(e: React.MouseEvent, path: string, rootId: number) {
  const st = useStore.getState();
  st.focusDir(path);
  const root = st.roots.find((r) => r.id === rootId);
  if (root) openMenu(e, () => [{ label: "開く", run: () => st.enterDir(path) }, "-", ...rootMenu(root, path)]);
}

function FileLine({
  file: f,
  top,
  on,
  recent,
  where,
  tagNames,
  columns,
  template,
}: {
  file: FileRow;
  top: number;
  on: boolean;
  recent: boolean;
  where: string;
  tagNames: string[];
  columns: Column[];
  template: string;
}) {
  const dim = on ? "" : "text-dim";
  const cell = (c: Column) => {
    switch (c) {
      case "place":
        return (
          <span key={c} className={`truncate ${dim}`} title={f.path}>
            {where}
          </span>
        );
      case "kind":
        return (
          <span key={c} className={`truncate ${dim}`}>
            {kindLabel(f.ext)}
          </span>
        );
      case "date":
        return recent ? (
          <span key={c} className={`flex min-w-0 items-center gap-1.5 tabular-nums ${dim}`} title={`更新日：${formatDate(f.mtime)}`}>
            <ChangeBadge change={f.change} on={on} />
            <span className="truncate">{formatDate(f.changedAt ?? 0)}</span>
          </span>
        ) : (
          <span key={c} className={`truncate tabular-nums ${dim}`}>
            {formatDate(f.mtime)}
          </span>
        );
      case "size":
        return (
          <span key={c} className={`truncate text-right tabular-nums ${dim}`}>
            {formatSize(f.size)}
          </span>
        );
      case "tags":
        return (
          <span key={c} className="flex min-w-0 gap-1 overflow-hidden">
            {tagNames.map((n) => (
              <span key={n} className={`shrink-0 rounded px-1.5 text-[11px] ${on ? "bg-white/20" : "bg-control"}`}>
                {n}
              </span>
            ))}
          </span>
        );
    }
  };
  return (
    <div
      onMouseDown={(e) => pressFile(e, f, on)}
      onDoubleClick={() => runCommand("file.open")}
      onContextMenu={(e) => fileContextMenu(e, f)}
      className={`absolute inset-x-0 grid items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"} ${f.missing ? "opacity-60" : ""}`}
      style={{ top, height: ROW_H, gridTemplateColumns: template }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <KindIcon ext={f.ext} on={on} />
        <span className="truncate">{f.name}</span>
        {f.note && (
          <span className={`shrink-0 ${dim}`} title={f.note}>
            <StickyNote size={12} aria-label="メモあり" />
          </span>
        )}
      </span>
      {columns.map(cell)}
    </div>
  );
}

/** 中のフォルダの行。ダブルクリックで入る。出すのは名前（と中のファイルの数）・場所・種類だけ。 */
function DirLine({
  dir,
  top,
  on,
  where,
  rootId,
  columns,
  template,
}: {
  dir: SubDir;
  top: number;
  on: boolean;
  where: string;
  rootId: number;
  columns: Column[];
  template: string;
}) {
  const dim = on ? "" : "text-dim";
  return (
    <div
      onMouseDown={(e) => e.button === 0 && useStore.getState().focusDir(dir.path)}
      onDoubleClick={() => useStore.getState().enterDir(dir.path)}
      onContextMenu={(e) => dirContextMenu(e, dir.path, rootId)}
      className={`absolute inset-x-0 grid items-center gap-3 px-4 ${on ? "bg-accent-fill text-white" : "hover:bg-hover"}`}
      style={{ top, height: ROW_H, gridTemplateColumns: template }}
      title={dir.path}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FolderIcon on={on} />
        <span className="truncate">{dir.name}</span>
        <span className={`shrink-0 text-[11px] tabular-nums ${dim}`}>{dir.count} 件</span>
      </span>
      {columns.map((c) =>
        c === "place" ? (
          <span key={c} className={`truncate ${dim}`}>
            {where.split("/").join(" › ")}
          </span>
        ) : c === "kind" ? (
          <span key={c} className={`truncate ${dim}`}>
            フォルダ
          </span>
        ) : (
          <span key={c} />
        ),
      )}
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
export function ChangeBadge({ change, on }: { change: FileRow["change"]; on: boolean }) {
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

export function EmptyList() {
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

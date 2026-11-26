/**
 * グリッド（docs/CONCEPT.md「ツールバーと表示の切り替え」）。種類の大きなアイコンと名前の枠を並べる。
 * 中身の小さなプレビューは出さない（CSP の判断と一緒に決める。docs/CONCEPT.md「小さなプレビュー」）。
 * 並びと選び方・ドラッグ・右クリックはリストと同じ（FileList.tsx）。矢印は上下で 1 行、左右で 1 つ動く。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StickyNote } from "lucide-react";
import type { FileRow } from "../lib/api";
import { runCommand } from "../lib/commands";
import type { SubDir } from "../lib/view";
import { useStore } from "../store";
import { ChangeBadge, dirContextMenu, fileContextMenu, focusIndex, placeOf, pressFile } from "./FileList";
import { FolderIcon, KindIcon } from "./KindIcon";

/** 枠のいちばん狭い幅・高さと、枠どうしの間（px）。 */
const CELL_MIN = 136;
const CELL_H = 132;
const GAP = 8;
const PAD = 12;

const dateOnly = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
const day = (ms: number) => (ms ? dateOnly.format(new Date(ms)) : "");

export function FileGrid() {
  const files = useStore((s) => s.files);
  const subdirs = useStore((s) => s.subdirs);
  const dirFocus = useStore((s) => s.dirFocus);
  const roots = useStore((s) => s.roots);
  const place = useStore((s) => s.place);
  const selected = useStore((s) => s.selected);
  const setGridCols = useStore((s) => s.setGridCols);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // 幅から 1 行の数を決める（上下の矢印もこの数で動く）
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (CELL_MIN + GAP)));
  useEffect(() => {
    setGridCols(cols);
  }, [cols, setGridCols]);

  const total = subdirs.length + files.length;
  const v = useVirtualizer({ count: Math.ceil(total / cols), getScrollElement: () => scroller.current, estimateSize: () => CELL_H + GAP, overscan: 4, paddingStart: PAD, paddingEnd: PAD });
  const chosen = new Set(selected);
  const root = place.kind === "root" ? roots.find((r) => r.id === place.id) : undefined;
  const recent = place.kind === "recent";

  // 矢印キーで選んだ枠が見えるように
  const last = selected[selected.length - 1];
  useEffect(() => {
    const i = focusIndex(subdirs, files, dirFocus, last);
    if (i >= 0) v.scrollToIndex(Math.floor(i / cols), { align: "auto" });
  }, [last, dirFocus, files, subdirs, cols, v]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}>
      <div style={{ height: v.getTotalSize(), position: "relative" }} onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}>
        {v.getVirtualItems().map((row) => (
          <div
            key={row.index}
            className="absolute grid"
            style={{ top: row.start, left: PAD, right: PAD, height: CELL_H, gap: GAP, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().clearSelection()}
          >
            {Array.from({ length: cols }, (_, c) => row.index * cols + c)
              .filter((i) => i < total)
              .map((i) => {
                if (i < subdirs.length) {
                  const d = subdirs[i];
                  return <DirCell key={`dir:${d.path}`} dir={d} on={dirFocus === d.path} rootId={root?.id ?? 0} />;
                }
                const f = files[i - subdirs.length];
                return <FileCell key={f.id} file={f} on={chosen.has(f.id)} recent={recent} where={placeOf(roots, root, f)} />;
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

const cellClass = (on: boolean) => `flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-2 pt-4 pb-2 text-center ${on ? "bg-accent-fill text-white" : "hover:bg-hover"}`;

function FileCell({ file: f, on, recent, where }: { file: FileRow; on: boolean; recent: boolean; where: string }) {
  const dim = on ? "text-white/80" : "text-dim";
  return (
    <div
      onMouseDown={(e) => pressFile(e, f, on)}
      onDoubleClick={() => runCommand("file.open")}
      onContextMenu={(e) => fileContextMenu(e, f)}
      className={`${cellClass(on)} ${f.missing ? "opacity-60" : ""}`}
      title={`${f.name}\n${f.missing ? "（行方不明）" : f.path}`}
    >
      <span className="relative">
        <KindIcon ext={f.ext} size={48} />
        {f.note && (
          <span className={`absolute -right-1.5 -bottom-0.5 rounded-full p-0.5 ${on ? "bg-white text-accent-fill" : "bg-raised text-dim shadow"}`}>
            <StickyNote size={11} aria-label="メモあり" />
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full text-[12px] leading-snug break-all">{f.name}</span>
      <span className={`flex w-full min-w-0 items-center justify-center gap-1 text-[11px] tabular-nums ${dim}`}>
        {recent && <ChangeBadge change={f.change} on={on} />}
        <span className="truncate">{f.missing ? where : day(recent ? (f.changedAt ?? 0) : f.mtime)}</span>
      </span>
    </div>
  );
}

function DirCell({ dir, on, rootId }: { dir: SubDir; on: boolean; rootId: number }) {
  return (
    <div
      onMouseDown={(e) => e.button === 0 && useStore.getState().focusDir(dir.path)}
      onDoubleClick={() => useStore.getState().enterDir(dir.path)}
      onContextMenu={(e) => dirContextMenu(e, dir.path, rootId)}
      className={cellClass(on)}
      title={dir.path}
    >
      <FolderIcon size={48} />
      <span className="line-clamp-2 w-full text-[12px] leading-snug break-all">{dir.name}</span>
      <span className={`text-[11px] tabular-nums ${on ? "text-white/80" : "text-dim"}`}>{dir.count} 件</span>
    </div>
  );
}

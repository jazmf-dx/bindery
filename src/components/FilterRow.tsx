/**
 * 条件の行（docs/CONCEPT.md「条件の組み合わせ」「ツールバーと表示の切り替え」）。今の場所の中を絞る。
 * 条件ごとの丸いボタンを押すと、値と件数（ほかの条件と絞り込みの文字をかけた数）のメニューが開く。
 * 使っている条件は色が付き、値を出し、▾ の代わりに ✕ で外せる（stockroom の FilterRow.tsx と同じ形）。
 * 条件が無いときも同じ高さで出す（一覧の位置を変えない）。
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ListFilter, Tag as TagIcon, X } from "lucide-react";
import type { FileRow } from "../lib/api";
import { iconKindName, iconKindOf, ICON_KINDS } from "../lib/kinds";
import { facetCounts, hasFilters, NO_FILTERS, withinSince, type FilterKey, type Within } from "../lib/view";
import { useStore } from "../store";
import { KindIcon } from "./KindIcon";
import { MenuHeading, MenuOption, Popover } from "./ui";

const WITHIN: { value: Within; label: string }[] = [
  { value: "today", label: "今日" },
  { value: 7, label: "7 日以内" },
  { value: 30, label: "30 日以内" },
  { value: 365, label: "1 年以内" },
];

/** 条件の丸いボタンとメニュー。`value` は選んでいる値の文（空なら使っていない）。 */
function Pill({
  label,
  value,
  disabled,
  title,
  onClear,
  width,
  children,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  title?: string;
  onClear: () => void;
  width?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const on = value !== "";
  return (
    <>
      <button
        ref={ref}
        disabled={disabled}
        title={title ?? (on ? `${label}：${value}` : label)}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 shrink-0 items-center gap-1 rounded-full border border-transparent pr-1 pl-2.5 whitespace-nowrap disabled:off ${
          on ? "bg-tonal text-on-tonal enabled:hover:brightness-110" : open ? "bg-press" : "bg-control enabled:hover:bg-hover"
        }`}
      >
        <span>{label}</span>
        {/* 長い値は切る（右のボタンを動かさない） */}
        {on && <span className="max-w-40 truncate font-medium">{value}</span>}
        {on ? (
          <span
            role="button"
            aria-label={`${label}の条件を外す`}
            title={`${label}の条件を外す`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onClear();
            }}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full hover:bg-ink/20"
          >
            <X size={11} />
          </span>
        ) : (
          <span className="flex h-4.5 w-4.5 items-center justify-center">
            <ChevronDown size={11} className="text-dim" />
          </span>
        )}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} width={width}>
          {children}
        </Popover>
      )}
    </>
  );
}

/** 条件のメニューの件数（`key` の条件だけを外して数える）。メニューを開いているときだけ数える。 */
function useCounts<V>(key: FilterKey, valuesOf: (f: FileRow) => V[]): Map<V, number> {
  const allFiles = useStore((s) => s.allFiles);
  const query = useStore((s) => s.query);
  const filters = useStore((s) => s.filters);
  const tags = useStore((s) => s.tags);
  // valuesOf は呼ぶたびに作られるので、依存に入れない（中身は key で決まる）
  return useMemo(() => facetCounts(allFiles, query, filters, tags, key, valuesOf), [allFiles, query, filters, tags, key]);
}

export function FilterRow() {
  const filters = useStore((s) => s.filters);
  const tags = useStore((s) => s.tags);
  const setFilters = useStore((s) => s.setFilters);
  const chosenTags = tags.filter((t) => filters.tags.includes(t.id));
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-3 text-[12px] [scrollbar-width:none]">
      <ListFilter size={13} className="mr-0.5 shrink-0 text-dim" aria-label="条件" />
      <Pill label="種類" value={filters.kinds.map(iconKindName).join("、")} onClear={() => setFilters({ ...filters, kinds: [] })} width="w-60">
        <KindMenu />
      </Pill>
      <Pill
        label="タグ"
        value={chosenTags.map((t) => t.name).join(filters.tagMode === "all" ? " かつ " : " または ")}
        disabled={tags.length === 0}
        title={tags.length === 0 ? "タグがありません（詳細パネルやサイドバーで作れます）" : undefined}
        onClear={() => setFilters({ ...filters, tags: [] })}
        width="w-64"
      >
        <TagMenu />
      </Pill>
      <Pill label="更新日" value={WITHIN.find((w) => w.value === filters.within)?.label ?? ""} onClear={() => setFilters({ ...filters, within: null })}>
        <WithinMenu />
      </Pill>
      <Pill label="メモ" value={filters.note === null ? "" : filters.note ? "あり" : "なし"} onClear={() => setFilters({ ...filters, note: null })} width="w-44">
        <NoteMenu />
      </Pill>
      <span className="flex-1" />
      {hasFilters(filters) && (
        <button className="ghost shrink-0 rounded-md px-1.5 py-0.5 text-dim" onClick={() => setFilters(NO_FILTERS)}>
          条件をすべて外す
        </button>
      )}
    </div>
  );
}

/** 選んだ値に足す・外す。 */
const toggled = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function KindMenu() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const counts = useCounts("kinds", (f) => [iconKindOf(f.ext)]);
  return (
    <>
      <MenuHeading>どれかの種類</MenuHeading>
      {ICON_KINDS.map((k) => (
        <MenuOption key={k} on={filters.kinds.includes(k)} count={counts.get(k) ?? 0} onClick={() => setFilters({ ...filters, kinds: toggled(filters.kinds, k) })}>
          <KindIcon kind={k} />
          {iconKindName(k)}
        </MenuOption>
      ))}
    </>
  );
}

function TagMenu() {
  const filters = useStore((s) => s.filters);
  const tags = useStore((s) => s.tags);
  const setFilters = useStore((s) => s.setFilters);
  const counts = useCounts("tags", (f) => f.tags);
  return (
    <>
      {/* 複数選んだときの組み合わせ方 */}
      <div role="group" aria-label="タグの組み合わせ方" className="mx-1 mt-1 mb-1.5 flex gap-0.5 rounded-md track">
        {(["all", "any"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={filters.tagMode === mode}
            onClick={() => setFilters({ ...filters, tagMode: mode })}
            className={`flex-1 rounded py-0.5 ${filters.tagMode === mode ? "thumb" : "text-fg/85 hover:bg-hover"}`}
          >
            {mode === "all" ? "すべて付いている" : "どれかが付いている"}
          </button>
        ))}
      </div>
      {tags.map((t) => (
        <MenuOption key={t.id} on={filters.tags.includes(t.id)} count={counts.get(t.id) ?? 0} onClick={() => setFilters({ ...filters, tags: toggled(filters.tags, t.id) })}>
          <TagIcon size={12} className="shrink-0 text-dim" />
          <span className="truncate">{t.name}</span>
        </MenuOption>
      ))}
    </>
  );
}

function WithinMenu() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const since = WITHIN.map((w) => [w.value, withinSince(w.value)] as const);
  const counts = useCounts("within", (f) => since.filter(([, t]) => f.mtime >= t).map(([w]) => w));
  return (
    <>
      <MenuHeading>ファイルの更新日</MenuHeading>
      {WITHIN.map((w) => (
        <MenuOption
          key={w.value}
          single
          on={filters.within === w.value}
          count={counts.get(w.value) ?? 0}
          onClick={() => setFilters({ ...filters, within: filters.within === w.value ? null : w.value })}
        >
          {w.label}
        </MenuOption>
      ))}
    </>
  );
}

function NoteMenu() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const counts = useCounts("note", (f) => [f.note !== ""]);
  return (
    <>
      {[true, false].map((v) => (
        <MenuOption key={String(v)} single on={filters.note === v} count={counts.get(v) ?? 0} onClick={() => setFilters({ ...filters, note: filters.note === v ? null : v })}>
          {v ? "メモあり" : "メモなし"}
        </MenuOption>
      ))}
    </>
  );
}

/**
 * 一覧に出す行を決める：今の場所のファイルを、絞り込みの文字で絞り、列で並べ替える
 * （docs/CONCEPT.md「探す」）。データベースから読んだ行はそのままにして、ここで写しを作る。
 */
import type { FileRow, Place, Root, Tag } from "./api";
import { iconKindOf, kindLabel, type IconKind } from "./kinds";
import { warn } from "./log";

export type SortKey = "name" | "place" | "kind" | "date" | "size";
export const SORT_KEYS: SortKey[] = ["name", "place", "kind", "date", "size"];
/** `date` は更新日（「最近の変更」では気付いた日）。 */
export type Sort = { key: SortKey; desc: boolean };

export const DEFAULT_SORT: Sort = { key: "name", desc: false };

/** 更新日の条件：今日（0 時から）か、その日数のうち。 */
export type Within = "today" | 7 | 30 | 365;

/**
 * 一覧の上の条件（docs/CONCEPT.md「条件の組み合わせ」「ツールバーと表示の切り替え」）。今の場所の中で絞る。
 * 条件どうしは「かつ」。タグは `tagMode` で、すべて付いているもの（all）かどれかが付いているもの（any）。
 * 種類は選んだもののどれか。更新日はファイルの更新日時で。メモは、あるもの（true）・無いもの（false）。
 */
export type Filters = { tags: number[]; tagMode: "all" | "any"; kinds: IconKind[]; within: Within | null; note: boolean | null };

export const NO_FILTERS: Filters = { tags: [], tagMode: "all", kinds: [], within: null, note: null };

export const hasFilters = (f: Filters) => f.tags.length > 0 || f.kinds.length > 0 || f.within !== null || f.note !== null;

/** 条件の 1 つ（件数を数えるとき、その条件だけを外すため）。 */
export type FilterKey = "tags" | "kinds" | "within" | "note";

/** `key` の条件を外したもの。 */
export function without(f: Filters, key: FilterKey): Filters {
  switch (key) {
    case "tags":
      return { ...f, tags: [] };
    case "kinds":
      return { ...f, kinds: [] };
    case "within":
      return { ...f, within: null };
    case "note":
      return { ...f, note: null };
  }
}

/** 更新日の条件の下限（ミリ秒）。 */
export function withinSince(w: Within, now = new Date()): number {
  if (w === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return now.getTime() - w * 86_400_000;
}

export function passes(f: FileRow, filters: Filters, since: number | null): boolean {
  if (filters.tags.length > 0) {
    const has = (t: number) => f.tags.includes(t);
    if (filters.tagMode === "all" ? !filters.tags.every(has) : !filters.tags.some(has)) return false;
  }
  if (filters.kinds.length > 0 && !filters.kinds.includes(iconKindOf(f.ext))) return false;
  if (since !== null && f.mtime < since) return false;
  if (filters.note !== null && (f.note !== "") !== filters.note) return false;
  return true;
}

/** 「最近の変更」の既定：気付いた日の新しい順。 */
export const RECENT_SORT: Sort = { key: "date", desc: true };

/** 全角・半角、大文字・小文字をそろえる。 */
const fold = (s: string) => s.normalize("NFKC").toLowerCase();

/**
 * 絞り込み：空白で区切った言葉がすべて、名前・場所・タグの名前・メモのどこかに入っているもの。
 */
export function matches(f: FileRow, terms: string[], tagName: Map<number, string>): boolean {
  if (terms.length === 0) return true;
  const hay = fold([f.name, f.path, ...f.tags.map((id) => tagName.get(id) ?? ""), f.note].join("\n"));
  return terms.every((t) => hay.includes(t));
}

export const termsOf = (query: string) => fold(query).split(/\s+/).filter(Boolean);

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** 場所の並び：ファイルのあるフォルダのパス（名前を除く）。 */
const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

export function compare(sort: Sort, recent: boolean): (a: FileRow, b: FileRow) => number {
  const byName = (a: FileRow, b: FileRow) => collator.compare(a.name, b.name) || collator.compare(a.path, b.path);
  const first = (a: FileRow, b: FileRow): number => {
    switch (sort.key) {
      case "name":
        return 0;
      case "place":
        return collator.compare(dirOf(a.path), dirOf(b.path));
      case "kind":
        return collator.compare(kindLabel(a.ext), kindLabel(b.ext));
      case "date":
        return recent ? (a.changedAt ?? 0) - (b.changedAt ?? 0) : a.mtime - b.mtime;
      case "size":
        return a.size - b.size;
    }
  };
  const dir = sort.desc ? -1 : 1;
  // 同じものどうしは、いつも名前の順（並びを逆にしても名前の順は変えない）
  return (a, b) => {
    if (sort.key === "name") return dir * byName(a, b);
    return dir * first(a, b) || byName(a, b);
  };
}

export function visible(all: FileRow[], query: string, filters: Filters, sort: Sort, recent: boolean, tags: Tag[]): FileRow[] {
  return narrow(all, query, filters, tags).sort(compare(sort, recent));
}

/** 絞り込みの文字と条件に合うもの（並びはそのまま）。 */
export function narrow(all: FileRow[], query: string, filters: Filters, tags: Tag[]): FileRow[] {
  const terms = termsOf(query);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const since = filters.within === null ? null : withinSince(filters.within);
  return all.filter((f) => passes(f, filters, since) && matches(f, terms, tagName));
}

/**
 * 条件のメニューに出す件数：`key` の条件だけを外し、ほかの条件と絞り込みの文字をかけた中で、値ごとに数える。
 * 値は `valuesOf` が返すもの（タグは付いている id、種類は 1 つ、など）。
 */
export function facetCounts<V>(all: FileRow[], query: string, filters: Filters, tags: Tag[], key: FilterKey, valuesOf: (f: FileRow) => V[]): Map<V, number> {
  const counts = new Map<V, number>();
  for (const f of narrow(all, query, without(filters, key), tags)) for (const v of valuesOf(f)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** 一覧の先頭に出す、今のフォルダの中のフォルダ。`count` は下の階層まで含めたファイルの数。 */
export type SubDir = { path: string; name: string; count: number };

/**
 * 登録フォルダ・中のフォルダを開いているとき、そのすぐ下のフォルダ（名前の順）。
 * 絞り込み・条件で絞っているときは出さない（探しているのはファイルなので）。
 */
export function childDirs(roots: Root[], place: Place, narrowing: boolean): SubDir[] {
  if (place.kind !== "root" || narrowing) return [];
  const root = roots.find((r) => r.id === place.id);
  if (!root) return [];
  const prefix = place.dir ? `${place.dir}/` : "";
  return root.dirs
    .filter((d) => d.path.startsWith(prefix) && d.path.length > prefix.length && !d.path.slice(prefix.length).includes("/"))
    .map((d) => ({
      path: d.path,
      name: d.path.slice(prefix.length),
      count: root.dirs.reduce((n, x) => (x.path === d.path || x.path.startsWith(`${d.path}/`) ? n + x.count : n), 0),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** 中のフォルダの 1 つ上（登録フォルダの直下なら空）。 */
export const parentDir = (dir: string) => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");

/** 列の見出しを押したとき：同じ列なら逆に、別の列なら日付は新しい順・ほかは昇順から。 */
export const nextSort = (now: Sort, key: SortKey): Sort => (now.key === key ? { key, desc: !now.desc } : { key, desc: key === "date" || key === "size" });

// 並べ替えは全体で 1 つ覚える（この端末のこのアプリだけ。読めなくても既定で動く）
const SORT_KEY = "bindery.sort";

export function loadSort(): Sort {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Sort | null;
    if (v && SORT_KEYS.includes(v.key) && typeof v.desc === "boolean") return v;
  } catch {
    // 既定で動く
  }
  return DEFAULT_SORT;
}

export function saveSort(sort: Sort) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort));
  } catch (e) {
    warn("save sort", e);
  }
}

/** 一覧の形（docs/CONCEPT.md「ツールバーと表示の切り替え」）：1 行ずつのリストか、種類のアイコンを並べるグリッドか。 */
export type Layout = "list" | "grid";

/** リストの列。名前の列はいつも出すので、ここには入れない。 */
export type Column = "place" | "kind" | "date" | "size" | "tags";
export const COLUMNS: Column[] = ["place", "kind", "date", "size", "tags"];
export const DEFAULT_COLUMNS: Column[] = ["place", "kind", "date", "tags"];

/** 左右のパネルの幅（px）：はじめ・いちばん狭い・いちばん広い。 */
export const PANEL_WIDTH = {
  sidebar: { initial: 240, min: 190, max: 420 },
  details: { initial: 320, min: 260, max: 560 },
} as const;
export type Panel = keyof typeof PANEL_WIDTH;

export const clampWidth = (panel: Panel, px: number) => Math.round(Math.min(PANEL_WIDTH[panel].max, Math.max(PANEL_WIDTH[panel].min, px)));

/** この端末の画面の設定（データベースには入れない。読めなくても既定で動く）。 */
export type Prefs = {
  layout: Layout;
  columns: Column[];
  sidebarOpen: boolean;
  detailsOpen: boolean;
  sidebarWidth: number;
  detailsWidth: number;
};

const PREFS_KEY = "bindery.prefs";

export const DEFAULT_PREFS: Prefs = {
  layout: "list",
  columns: DEFAULT_COLUMNS,
  sidebarOpen: true,
  detailsOpen: true,
  sidebarWidth: PANEL_WIDTH.sidebar.initial,
  detailsWidth: PANEL_WIDTH.details.initial,
};

export function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!v || typeof v !== "object") return DEFAULT_PREFS;
    const num = (x: unknown, panel: Panel) => (typeof x === "number" && Number.isFinite(x) ? clampWidth(panel, x) : PANEL_WIDTH[panel].initial);
    return {
      layout: v.layout === "grid" ? "grid" : "list",
      columns: Array.isArray(v.columns) ? COLUMNS.filter((c) => v.columns!.includes(c)) : DEFAULT_COLUMNS,
      sidebarOpen: v.sidebarOpen !== false,
      detailsOpen: v.detailsOpen !== false,
      sidebarWidth: num(v.sidebarWidth, "sidebar"),
      detailsWidth: num(v.detailsWidth, "details"),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    warn("save prefs", e);
  }
}

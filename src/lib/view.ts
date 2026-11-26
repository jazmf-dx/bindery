/**
 * 一覧に出す行を決める：今の場所のファイルを、絞り込みの文字で絞り、列で並べ替える
 * （docs/CONCEPT.md「探す」）。データベースから読んだ行はそのままにして、ここで写しを作る。
 */
import type { FileRow, Place, Root, Tag } from "./api";
import { kindLabel, kindOf, type Kind } from "./kinds";
import { warn } from "./log";

export type SortKey = "name" | "place" | "kind" | "date";
/** `date` は更新日（「最近の変更」では気付いた日）。 */
export type Sort = { key: SortKey; desc: boolean };

export const DEFAULT_SORT: Sort = { key: "name", desc: false };

/** 更新日の条件：今日（0 時から）か、その日数のうち。 */
export type Within = "today" | 7 | 30 | 365;

/**
 * 一覧の上の条件（docs/CONCEPT.md「条件の組み合わせ」）。今の場所の中で絞る。
 * タグはすべて付いているもの（かつ）、種類は 1 つ、更新日はファイルの更新日時で。
 */
export type Filters = { tags: number[]; kind: Kind | null; within: Within | null };

export const NO_FILTERS: Filters = { tags: [], kind: null, within: null };

export const hasFilters = (f: Filters) => f.tags.length > 0 || f.kind !== null || f.within !== null;

/** 更新日の条件の下限（ミリ秒）。 */
export function withinSince(w: Within, now = new Date()): number {
  if (w === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return now.getTime() - w * 86_400_000;
}

export function passes(f: FileRow, filters: Filters, since: number | null): boolean {
  if (filters.tags.some((t) => !f.tags.includes(t))) return false;
  if (filters.kind !== null && kindOf(f.ext) !== filters.kind) return false;
  if (since !== null && f.mtime < since) return false;
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
  const terms = termsOf(query);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const since = filters.within === null ? null : withinSince(filters.within);
  return all.filter((f) => passes(f, filters, since) && matches(f, terms, tagName)).sort(compare(sort, recent));
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
export const nextSort = (now: Sort, key: SortKey): Sort => (now.key === key ? { key, desc: !now.desc } : { key, desc: key === "date" });

// 並べ替えは全体で 1 つ覚える（この端末のこのアプリだけ。読めなくても既定で動く）
const SORT_KEY = "bindery.sort";

export function loadSort(): Sort {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Sort | null;
    if (v && ["name", "place", "kind", "date"].includes(v.key) && typeof v.desc === "boolean") return v;
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

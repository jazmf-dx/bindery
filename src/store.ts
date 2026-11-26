/**
 * 画面の状態。データの正本は Rust 側のデータベースで、ここはその写し
 * （`files-changed` が届いたら、また自分で変えたら読み直す）。
 */
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, type FileRow, type Place, type Root, type Tag, type VFolder } from "./lib/api";
import { EXTENSIONS, kindOfPath } from "./lib/kinds";
import { warn } from "./lib/log";
import { childDirs, hasFilters, loadSort, nextSort, NO_FILTERS, parentDir, RECENT_SORT, saveSort, visible, type Filters, type Sort, type SortKey, type SubDir } from "./lib/view";

export const samePlace = (a: Place, b: Place) =>
  a.kind === b.kind && ("id" in a ? a.id : null) === ("id" in b ? b.id : null) && ("dir" in a ? a.dir : null) === ("dir" in b ? b.dir : null);

/**
 * ドラッグ。ファイル（一覧の行）はサイドバーのタグ・仮想フォルダへ、
 * 仮想フォルダ（サイドバーの行。`folder` がその id）は別の仮想フォルダの下か一番上へ落とす。
 */
export type Drag = { ids: number[]; x: number; y: number; label: string; folder?: number };

/** サイドバーで名前を打ち込み中の行。 */
export type Editing =
  | { kind: "newTag" }
  | { kind: "newFolder"; parentId: number | null }
  | { kind: "tag"; id: number }
  | { kind: "folder"; id: number };

type State = {
  roots: Root[];
  /** 今の場所のファイル（データベースから読んだまま）。 */
  allFiles: FileRow[];
  /** 一覧に出すもの：`allFiles` を絞り込み、並べ替えたもの。選ぶ・矢印で動くのはこの順。 */
  files: FileRow[];
  /** 一覧の先頭に出す、今のフォルダの中のフォルダ（登録フォルダ・中のフォルダを開いているときだけ）。 */
  subdirs: SubDir[];
  /** 一覧で選んでいるフォルダの行（ファイルの選択とは同時に持たない）。 */
  dirFocus: string | null;
  /** 絞り込みの文字（今の場所の中で絞る。場所を変えても残す）。 */
  query: string;
  /** 一覧の上の条件（タグ・種類・更新日）。絞り込みと同じく、場所を変えても残す。 */
  filters: Filters;
  /** 並べ替え（全体で 1 つ覚える）。 */
  sort: Sort;
  /** 「最近の変更」での並べ替え（覚えない。開くたびに気付いた日の新しい順）。 */
  recentSort: Sort;
  tags: Tag[];
  vfolders: VFolder[];
  place: Place;
  /** 選んでいるファイル（並びは選んだ順ではなく一覧の順）。 */
  selected: number[];
  /** Shift クリックの起点。 */
  anchor: number | null;
  scanning: boolean;
  missingCount: number;
  recentCount: number;
  drag: Drag | null;
  editing: Editing | null;

  load: () => Promise<void>;
  go: (place: Place) => void;
  setQuery: (query: string) => void;
  setFilters: (filters: Filters) => void;
  sortBy: (key: SortKey) => void;
  click: (id: number, e: { shift: boolean; toggle: boolean }) => void;
  /** 一覧のフォルダの行を選ぶ。 */
  focusDir: (path: string) => void;
  /** 今の登録フォルダの中のフォルダへ入る。 */
  enterDir: (path: string) => void;
  /** 1 つ上のフォルダへ（入っていたフォルダを選んだままにする）。 */
  goUp: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  step: (delta: number, extend: boolean) => void;
  setScanning: (on: boolean) => void;
  setDrag: (drag: Drag | null) => void;
  setEditing: (editing: Editing | null) => void;

  addRootDialog: () => Promise<void>;
  /**
   * ダイアログで選んだ・ウィンドウへ落としたものを登録する。フォルダはサブフォルダがあれば読むか聞く。
   * ファイルだけのときは、入っているフォルダを直下だけで登録して、そのファイルを選ぶ（docs/CONCEPT.md「ファイルを落としたとき」）。
   */
  addRoots: (paths: string[]) => Promise<void>;
  /** 登録フォルダ（`dir` はその中のフォルダ）を Finder / エクスプローラーで表示する。 */
  revealRoot: (id: number, dir: string) => void;
  removeRoot: (id: number) => Promise<void>;

  openSelected: () => void;
  quickLook: () => void;
  revealSelected: () => void;
  copyPaths: () => void;
  /** 行方不明のファイル（1 件）を、ダイアログで選んだファイルへつなぎ直す。 */
  relinkSelected: () => Promise<void>;
  /** 選んでいる行方不明のファイルの記録を外す（確かめてから）。 */
  forgetSelected: () => Promise<void>;
  setNote: (id: number, note: string) => Promise<void>;
  /** 選んでいるファイルを、今のタグ・仮想フォルダから外す。 */
  removeFromPlace: () => Promise<void>;

  addTag: (ids: number[], name: string) => Promise<void>;
  setTag: (ids: number[], tagId: number, on: boolean) => Promise<void>;
  createTag: (name: string) => Promise<void>;
  renameTag: (id: number, name: string) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  createFolder: (name: string, parentId: number | null) => Promise<void>;
  renameFolder: (id: number, name: string) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  setFolder: (ids: number[], folderId: number, on: boolean) => Promise<void>;
  /** 仮想フォルダを別の仮想フォルダの下へ（null は一番上へ）移す。 */
  moveFolder: (id: number, parentId: number | null) => Promise<void>;
};

/** 読み込みが終わったら選ぶファイルのパス（落としたファイルの登録）。見つけたら、または読み込みが終わったら空にする。 */
let pendingSelect: string[] = [];

let loading: Promise<void> | null = null;
let again = false;

/** 失敗したら、ダイアログで知らせてから読み直す。 */
async function attempt(title: string, f: () => Promise<unknown>) {
  try {
    await f();
  } catch (e) {
    await message(String(e), { title, kind: "warning" });
  }
  await useStore.getState().load();
}

/** 今の状態から、一覧に出す行と、まだ見えている選択を作り直す。 */
function refresh(s: Pick<State, "allFiles" | "query" | "filters" | "sort" | "recentSort" | "place" | "tags" | "selected" | "roots" | "dirFocus">) {
  const recent = s.place.kind === "recent";
  const files = visible(s.allFiles, s.query, s.filters, recent ? s.recentSort : s.sort, recent, s.tags);
  const still = new Set(files.map((f) => f.id));
  const subdirs = childDirs(s.roots, s.place, s.query.trim() !== "" || hasFilters(s.filters));
  const dirFocus = s.dirFocus !== null && subdirs.some((d) => d.path === s.dirFocus) ? s.dirFocus : null;
  return { files, subdirs, dirFocus, selected: s.selected.filter((id) => still.has(id)) };
}

export const useStore = create<State>((set, get) => ({
  roots: [],
  allFiles: [],
  files: [],
  subdirs: [],
  dirFocus: null,
  query: "",
  filters: NO_FILTERS,
  sort: loadSort(),
  recentSort: RECENT_SORT,
  tags: [],
  vfolders: [],
  place: { kind: "all" },
  selected: [],
  anchor: null,
  scanning: false,
  missingCount: 0,
  recentCount: 0,
  drag: null,
  editing: null,

  // 読み直しが重なったら、終わったあとに 1 回だけもう一度読む（届いた知らせを取りこぼさない）。
  load: () => {
    if (loading) {
      again = true;
      return loading;
    }
    loading = (async () => {
      do {
        again = false;
        try {
          const { place } = get();
          const [roots, tags, vfolders, files] = await Promise.all([
            api.listRoots(),
            api.listTags(),
            api.listVFolders(),
            api.listFiles(place),
          ]);
          // 選んでいた場所が無くなった（外した・消した）ら「すべてのファイル」へ
          const gone =
            (place.kind === "root" && !roots.some((r) => r.id === place.id)) ||
            (place.kind === "tag" && !tags.some((t) => t.id === place.id)) ||
            (place.kind === "folder" && !vfolders.some((v) => v.id === place.id));
          const missingCount = roots.reduce((n, r) => n + r.missing, 0);
          const recentCount = roots.reduce((n, r) => n + r.recent, 0);
          // 選んでいた中のフォルダが無くなった（ファイルが無くなった・動いた）ら、その登録フォルダへ
          if (place.kind === "root" && place.dir && !gone && !roots.find((r) => r.id === place.id)?.dirs.some((d) => d.path === place.dir)) {
            set({ roots, tags, vfolders, missingCount, recentCount, place: { kind: "root", id: place.id, dir: "" } });
            again = true;
            continue;
          }
          if (gone) {
            set({ roots, tags, vfolders, missingCount, recentCount, place: { kind: "all" } });
            again = true;
            continue;
          }
          // 消したタグは条件からも外す
          const f = get().filters;
          const filters = f.tags.every((id) => tags.some((t) => t.id === id)) ? f : { ...f, tags: f.tags.filter((id) => tags.some((t) => t.id === id)) };
          const next = refresh({ ...get(), allFiles: files, tags, filters, roots });
          // 落としたファイルを登録したあと：見つかったら選ぶ
          if (pendingSelect.length) {
            const want = new Set(pendingSelect);
            const found = next.files.filter((x) => want.has(x.path)).map((x) => x.id);
            if (found.length) {
              next.selected = found;
              next.dirFocus = null;
              pendingSelect = [];
            }
          }
          set({ roots, tags, vfolders, missingCount, recentCount, allFiles: files, filters, ...next, ...(next.selected.length ? { anchor: next.selected[0] } : {}) });
        } catch (e) {
          warn("load", e);
        }
      } while (again);
      loading = null;
    })();
    return loading;
  },

  go: (place) => {
    pendingSelect = [];
    // 「最近の変更」は、開くたびに気付いた日の新しい順から
    set({ place, selected: [], anchor: null, dirFocus: null, ...(place.kind === "recent" ? { recentSort: RECENT_SORT } : {}) });
    get().load();
  },

  focusDir: (path) => set({ dirFocus: path, selected: [], anchor: null }),

  enterDir: (path) => {
    const { place } = get();
    if (place.kind === "root") get().go({ kind: "root", id: place.id, dir: path });
  },

  goUp: () => {
    const { place } = get();
    if (place.kind !== "root" || !place.dir) return;
    const from = place.dir;
    get().go({ kind: "root", id: place.id, dir: parentDir(from) });
    // 読み終わる前でも選んでおく（refresh で、出てこなければ外れる）
    set({ dirFocus: from });
  },

  setQuery: (query) => set({ query, ...refresh({ ...get(), query }) }),
  setFilters: (filters) => set({ filters, ...refresh({ ...get(), filters }) }),

  sortBy: (key) => {
    const s = get();
    if (s.place.kind === "recent") {
      const recentSort = nextSort(s.recentSort, key);
      set({ recentSort, ...refresh({ ...s, recentSort }) });
      return;
    }
    const sort = nextSort(s.sort, key);
    saveSort(sort);
    set({ sort, ...refresh({ ...s, sort }) });
  },

  click: (id, { shift, toggle }) => {
    const { files, selected, anchor } = get();
    if (shift && anchor !== null) {
      const a = files.findIndex((f) => f.id === anchor);
      const b = files.findIndex((f) => f.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        set({ selected: files.slice(lo, hi + 1).map((f) => f.id), dirFocus: null });
        return;
      }
    }
    if (toggle) {
      const on = selected.includes(id);
      set({ selected: on ? selected.filter((x) => x !== id) : [...selected, id], anchor: id, dirFocus: null });
      return;
    }
    set({ selected: [id], anchor: id, dirFocus: null });
  },

  selectAll: () => set({ selected: get().files.map((f) => f.id), dirFocus: null }),
  clearSelection: () => set({ selected: [], anchor: null, dirFocus: null }),

  // 一覧の行は、先頭のフォルダの行に続けてファイルの行。矢印はその順に動く（範囲を選ぶのはファイルだけ）
  step: (delta, extend) => {
    const { files, subdirs, dirFocus, selected, anchor } = get();
    const total = subdirs.length + files.length;
    if (total === 0) return;
    const last = selected.length ? selected[selected.length - 1] : null;
    const at =
      dirFocus !== null
        ? subdirs.findIndex((d) => d.path === dirFocus)
        : last !== null
          ? subdirs.length + files.findIndex((f) => f.id === last)
          : delta > 0
            ? -1
            : total;
    const to = Math.min(total - 1, Math.max(0, at + delta));
    if (to < subdirs.length) {
      if (!extend) get().focusDir(subdirs[to].path);
      return;
    }
    const next = files[to - subdirs.length];
    if (extend && anchor !== null && dirFocus === null) get().click(next.id, { shift: true, toggle: false });
    else set({ selected: [next.id], anchor: next.id, dirFocus: null });
  },

  setScanning: (scanning) => set({ scanning }),
  setDrag: (drag) => set({ drag }),
  setEditing: (editing) => set({ editing }),

  addRootDialog: async () => {
    const path = await open({ directory: true, title: "登録するフォルダを選ぶ" });
    if (typeof path === "string") await get().addRoots([path]);
  },

  addRoots: async (paths) => {
    let infos;
    try {
      infos = await api.inspectPaths(paths);
    } catch (e) {
      await message(String(e), { title: "フォルダを登録できませんでした", kind: "warning" });
      return;
    }
    const dirs = infos.filter((p) => p.isDir);
    const others = infos.length - dirs.length;
    // ファイルだけを落としたとき：ファイルを 1 つずつは足さず、入っているフォルダで代える
    if (dirs.length === 0) {
      await addFilesByFolder(infos.map((p) => p.path));
      return;
    }
    // サブフォルダを読むかは、サブフォルダのあるフォルダがあるときだけ聞く。まとめて落としたときは 1 回だけ聞く
    let recursive = true;
    const nested = dirs.filter((d) => d.hasSubdirs);
    if (nested.length > 0) {
      const what = nested.length === 1 ? `「${baseName(nested[0].path)}」` : `${nested.length} 個のフォルダ`;
      const yes = "サブフォルダも含める";
      const no = "このフォルダだけ";
      const answer = await message(`${what}にはサブフォルダがあります。サブフォルダの中のファイルも読み込みますか？\nあとから変えるには、登録を外して登録し直します。`, {
        title: "サブフォルダも読み込みますか？",
        kind: "info",
        buttons: { yes, no, cancel: "やめる" },
      });
      if (answer !== yes && answer !== no) return;
      recursive = answer === yes;
    }
    const failed: string[] = [];
    let last: number | null = null;
    for (const d of dirs) {
      try {
        last = (await api.addRoot(d.path, recursive)).id;
      } catch (e) {
        failed.push(dirs.length > 1 ? `${baseName(d.path)}：${String(e)}` : String(e));
      }
    }
    if (others > 0) failed.push(`ファイル ${others} 件は登録していません（登録できるのはフォルダだけです）。`);
    if (last !== null) get().go({ kind: "root", id: last, dir: "" });
    else await get().load();
    if (failed.length) await message(failed.join("\n"), { title: last === null ? "フォルダを登録できませんでした" : "一部を登録できませんでした", kind: "warning" });
  },

  revealRoot: (id, dir) => {
    api.revealRoot(id, dir).catch((e) => message(String(e), { title: "表示できませんでした", kind: "warning" }));
  },

  removeRoot: async (id) => {
    const root = get().roots.find((r) => r.id === id);
    if (!root) return;
    // タグ・仮想フォルダ・メモが付いたものがあれば、消える前に確かめる（docs/CONCEPT.md「登録を外す」）
    const organized = await api.rootOrganizedCount(id).catch(() => 0);
    if (organized > 0) {
      const ok = await ask(
        `「${root.name}」の ${organized} 件のファイルに付けたタグ・仮想フォルダ・メモも消えます。元のファイルには触りません。`,
        { title: "登録を外しますか？", kind: "warning", okLabel: "外す", cancelLabel: "やめる" },
      );
      if (!ok) return;
    }
    await attempt("登録を外せませんでした", () => api.removeRoot(id));
  },

  openSelected: () => {
    const { dirFocus } = get();
    if (dirFocus !== null) return get().enterDir(dirFocus);
    const ids = get().selected;
    if (ids.length) api.openFiles(ids).catch((e) => message(String(e), { title: "開けませんでした", kind: "warning" }));
  },
  quickLook: () => {
    api.quickLook(get().selected).catch((e) => message(String(e), { title: "Quick Look", kind: "warning" }));
  },
  revealSelected: () => {
    const id = get().selected[0];
    if (id !== undefined) api.revealFile(id).catch((e) => message(String(e), { title: "表示できませんでした", kind: "warning" }));
  },
  copyPaths: () => {
    const { files, selected } = get();
    const text = files
      .filter((f) => selected.includes(f.id))
      .map((f) => f.path)
      .join("\n");
    if (text) navigator.clipboard.writeText(text).catch((e) => warn("copy path", e));
  },

  relinkSelected: async () => {
    const { files, selected, roots } = get();
    const f = selected.length === 1 ? files.find((x) => x.id === selected[0]) : undefined;
    if (!f?.missing) return;
    const path = await open({
      title: `「${f.name}」の今の場所を選ぶ`,
      defaultPath: roots.find((r) => r.id === f.rootId)?.path,
      multiple: false,
      directory: false,
      filters: [{ name: "PDF・オフィス文書・テキスト", extensions: EXTENSIONS }],
    });
    if (typeof path !== "string") return;
    await attempt("つなぎ直せませんでした", () => api.relinkFile(f.id, path));
  },

  forgetSelected: async () => {
    const { files, selected } = get();
    const targets = files.filter((f) => f.missing && selected.includes(f.id));
    if (targets.length === 0) return;
    const organized = targets.filter((f) => f.tags.length || f.folders.length || f.note).length;
    const what = targets.length === 1 ? `「${targets[0].name}」` : `${targets.length} 件の行方不明のファイル`;
    const lost = organized > 0 ? `${targets.length === 1 ? "" : `${organized} 件に`}付けたタグ・仮想フォルダ・メモも消えます。` : "";
    const ok = await ask(`${what}の記録をアプリから消します。${lost}元のファイルには触りません。`, {
      title: "記録を外しますか？",
      kind: "warning",
      okLabel: "外す",
      cancelLabel: "やめる",
    });
    if (!ok) return;
    await attempt("記録を外せませんでした", () => api.forgetFiles(targets.map((f) => f.id)));
  },

  setNote: (id, note) => attempt("メモを書けませんでした", () => api.setNote(id, note)),

  removeFromPlace: async () => {
    const { place, selected } = get();
    if (!selected.length) return;
    if (place.kind === "tag") await get().setTag(selected, place.id, false);
    else if (place.kind === "folder") await get().setFolder(selected, place.id, false);
  },

  addTag: (ids, name) => attempt("タグを付けられませんでした", () => api.addTag(ids, name)),
  setTag: (ids, tagId, on) => attempt("タグを変えられませんでした", () => api.setTag(ids, tagId, on)),
  createTag: (name) => attempt("タグを作れませんでした", () => api.createTag(name)),
  renameTag: (id, name) => attempt("名前を変えられませんでした", () => api.renameTag(id, name)),
  deleteTag: async (id) => {
    const tag = get().tags.find((t) => t.id === id);
    if (!tag) return;
    if (tag.count > 0) {
      const ok = await ask(`${tag.count} 件のファイルから外れます。元のファイルには触りません。`, {
        title: `タグ「${tag.name}」を消しますか？`,
        kind: "warning",
        okLabel: "消す",
        cancelLabel: "やめる",
      });
      if (!ok) return;
    }
    await attempt("タグを消せませんでした", () => api.deleteTag(id));
  },

  createFolder: (name, parentId) => attempt("仮想フォルダを作れませんでした", () => api.createVFolder(name, parentId)),
  renameFolder: (id, name) => attempt("名前を変えられませんでした", () => api.renameVFolder(id, name)),
  deleteFolder: async (id) => {
    const { vfolders } = get();
    const folder = vfolders.find((v) => v.id === id);
    if (!folder) return;
    // 下の仮想フォルダも消えるので、数えて知らせる
    const under = (pid: number): number =>
      vfolders.filter((v) => v.parentId === pid).reduce((n, v) => n + 1 + under(v.id), 0);
    const subs = under(id);
    if (folder.count > 0 || subs > 0) {
      const parts = [subs > 0 ? `中の仮想フォルダ ${subs} 個も消えます。` : "", "入れていたファイルと元のファイルはそのままです。"];
      const ok = await ask(parts.join(""), {
        title: `仮想フォルダ「${folder.name}」を消しますか？`,
        kind: "warning",
        okLabel: "消す",
        cancelLabel: "やめる",
      });
      if (!ok) return;
    }
    await attempt("仮想フォルダを消せませんでした", () => api.deleteVFolder(id));
  },
  setFolder: (ids, folderId, on) => attempt("仮想フォルダを変えられませんでした", () => api.setVFolder(ids, folderId, on)),
  moveFolder: async (id, parentId) => {
    const v = get().vfolders.find((x) => x.id === id);
    if (!v || v.parentId === parentId || id === parentId) return;
    await attempt("仮想フォルダを移せませんでした", () => api.moveVFolder(id, parentId));
  },
}));

/** 登録フォルダのうち、そのファイルを読むもの（src-tauri/src/library.rs `root_for` と同じ）と、その中のフォルダ。 */
export function rootFor(path: string, roots: Root[]): { root: Root; dir: string } | null {
  const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean);
  const file = parts(path);
  let best: { root: Root; dir: string } | null = null;
  for (const r of roots) {
    const rp = parts(r.path);
    const inside = file.length > rp.length && rp.every((x, i) => x === file[i]);
    if (!inside) continue;
    const dirs = file.slice(rp.length, -1);
    if (!r.recursive && dirs.length > 0) continue;
    if (!best || r.path.length > best.root.path.length) best = { root: r, dir: dirs.join("/") };
  }
  return best;
}

/** パスの入っているフォルダ。 */
const parentOf = (path: string) => path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");

/**
 * 落としたファイル（フォルダなし）：入っているフォルダが登録済みならそこを開いて選ぶ。
 * まだなら、入っているフォルダを直下だけで登録してよいか聞き、登録して選ぶ（docs/CONCEPT.md「ファイルを落としたとき」）。
 */
async function addFilesByFolder(paths: string[]) {
  const st = useStore.getState();
  const files = paths.filter((p) => kindOfPath(p) !== null);
  if (files.length === 0) {
    await message("扱えるのは PDF・オフィス文書・テキストです。", { title: "このファイルは扱えません", kind: "info" });
    return;
  }
  const known = files.map((p) => ({ path: p, at: rootFor(p, st.roots) }));
  const fresh = [...new Set(known.filter((k) => !k.at).map((k) => parentOf(k.path)))];
  let last: { id: number; dir: string } | null = null;
  const at = known.find((k) => k.at)?.at;
  if (at) last = { id: at.root.id, dir: at.dir };
  if (fresh.length > 0) {
    const what = fresh.length === 1 ? `「${baseName(fresh[0])}」` : `${fresh.length} 個のフォルダ`;
    const yes = "フォルダを登録";
    const answer = await message(
      `ファイルを 1 つずつ足すことはできません。入っている${what}を、そのフォルダだけ（サブフォルダは読まない）で登録して、ファイルを選びますか？\nファイルは元の場所に置いたままです。`,
      { title: "入っているフォルダを登録しますか？", kind: "info", buttons: { ok: yes, cancel: "やめる" } },
    );
    if (answer !== yes && answer !== "Ok") return;
    const failed: string[] = [];
    for (const dir of fresh) {
      try {
        last = { id: (await api.addRoot(dir, false)).id, dir: "" };
      } catch (e) {
        failed.push(fresh.length > 1 ? `${baseName(dir)}：${String(e)}` : String(e));
      }
    }
    if (failed.length) await message(failed.join("\n"), { title: "フォルダを登録できませんでした", kind: "warning" });
  }
  if (!last) return;
  st.go({ kind: "root", id: last.id, dir: last.dir });
  // 読み込みが終わって一覧に出たら選ぶ（ほかの場所へ移ったらやめる）
  pendingSelect = files;
}

/** パスの最後の名前。 */
export const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;

/** 仮想フォルダの道筋（「案件 › A社」）。 */
export function folderPath(vfolders: VFolder[], id: number): string {
  const names: string[] = [];
  let at: VFolder | undefined = vfolders.find((v) => v.id === id);
  while (at) {
    names.unshift(at.name);
    const pid: number | null = at.parentId;
    at = pid === null ? undefined : vfolders.find((v) => v.id === pid);
  }
  return names.join(" › ");
}

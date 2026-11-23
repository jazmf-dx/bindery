/**
 * 画面の状態。データの正本は Rust 側のデータベースで、ここはその写し
 * （`files-changed` が届いたら読み直す）。
 */
import { message, open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, type FileRow, type Root, type View } from "./lib/api";
import { warn } from "./lib/log";

/** サイドバーで選んでいるもの。 */
export type Place = { view: View; rootId: number | null };

type State = {
  roots: Root[];
  files: FileRow[];
  place: Place;
  selectedId: number | null;
  scanning: boolean;
  /** 行方不明の数（サイドバーに出す）。 */
  missingCount: number;

  load: () => Promise<void>;
  go: (place: Place) => void;
  select: (id: number | null) => void;
  setScanning: (on: boolean) => void;
  addRootDialog: () => Promise<void>;
  removeRoot: (id: number) => Promise<void>;
};

let loading: Promise<void> | null = null;
let again = false;

export const useStore = create<State>((set, get) => ({
  roots: [],
  files: [],
  place: { view: "all", rootId: null },
  selectedId: null,
  scanning: false,
  missingCount: 0,

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
          const [roots, files] = await Promise.all([api.listRoots(), api.listFiles(place.view, place.rootId)]);
          const missingCount = roots.reduce((n, r) => n + r.missing, 0);
          // 外したフォルダを選んでいたら「すべてのファイル」へ
          if (place.rootId !== null && !roots.some((r) => r.id === place.rootId)) {
            set({ roots, missingCount, place: { view: "all", rootId: null } });
            again = true;
            continue;
          }
          const selectedId = files.some((f) => f.id === get().selectedId) ? get().selectedId : null;
          set({ roots, files, missingCount, selectedId });
        } catch (e) {
          warn("load", e);
        }
      } while (again);
      loading = null;
    })();
    return loading;
  },

  go: (place) => {
    set({ place, selectedId: null });
    get().load();
  },

  select: (selectedId) => set({ selectedId }),
  setScanning: (scanning) => set({ scanning }),

  addRootDialog: async () => {
    const path = await open({ directory: true, title: "登録するフォルダを選ぶ" });
    if (typeof path !== "string") return;
    try {
      const root = await api.addRoot(path);
      get().go({ view: "all", rootId: root.id });
    } catch (e) {
      await message(String(e), { title: "フォルダを登録できませんでした", kind: "warning" });
    }
  },

  removeRoot: async (id) => {
    try {
      await api.removeRoot(id);
    } catch (e) {
      await message(String(e), { title: "登録を外せませんでした", kind: "warning" });
    }
    get().load();
  },
}));

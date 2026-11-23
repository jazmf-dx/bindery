/**
 * 詳細パネル（docs/CONCEPT.md「プレビュー」「サイドバー」）。選んだファイルの情報・タグ・仮想フォルダと、開く操作。
 * 複数を選んだときは、タグ・仮想フォルダの付け外しをまとめて行う（一部にだけ付いているものは薄く出す）。
 * 小さなプレビューはあとで（CSP の判断と一緒に）。今は Quick Look（スペース）で大きく見る。
 */
import { useState, type ReactNode } from "react";
import { Copy, Eye, FolderSearch, Folder, SquareArrowOutUpRight, Tag as TagIcon, X } from "lucide-react";
import type { FileRow } from "../lib/api";
import { keyLabel, runCommand } from "../lib/commands";
import { composing } from "../lib/ime";
import { formatDate, formatSize, kindLabel } from "../lib/kinds";
import { dragRegion } from "../lib/titleBar";
import { folderPath, useStore } from "../store";
import { KindIcon } from "./FileList";

export function Details() {
  const files = useStore((s) => s.files);
  const selectedIds = useStore((s) => s.selected);
  const chosen = new Set(selectedIds);
  const selected = files.filter((f) => chosen.has(f.id));
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel" {...dragRegion()}>
      <div className="flex flex-col gap-4 p-4 pt-[calc(var(--titlebar)+16px)]">
        {selected.length === 0 ? (
          <div className="text-dim">ファイルを選ぶと、情報・タグ・仮想フォルダがここに出ます。スペースで Quick Look</div>
        ) : (
          <>
            {selected.length === 1 ? <About file={selected[0]} /> : <div className="font-semibold">{selected.length} 件を選択</div>}
            <Actions files={selected} />
            <Tags files={selected} />
            <Folders files={selected} />
          </>
        )}
      </div>
    </aside>
  );
}

function About({ file }: { file: FileRow }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <KindIcon ext={file.ext} />
        <span className="break-all font-semibold">{file.name}</span>
      </div>
      {file.missing && <div className="rounded-md bg-tonal px-2 py-1 text-on-tonal">行方不明：最後に見た場所にありません</div>}
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5">
        <Field label="種類">{kindLabel(file.ext)}</Field>
        <Field label="大きさ">{formatSize(file.size)}</Field>
        <Field label="更新日">{formatDate(file.mtime)}</Field>
        <Field label="場所">
          <span className="break-all select-text">{file.path}</span>
        </Field>
      </dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  );
}

/** 開く操作。行方不明だけのときは押せない（場所はそのまま、無効の見た目にする）。 */
function Actions({ files }: { files: FileRow[] }) {
  const off = files.every((f) => f.missing);
  const btn = (id: string, icon: ReactNode, label: string, disabled = off) => (
    <button
      className="flex items-center gap-1.5 rounded-md border border-edge bg-control px-2 py-1 disabled:off"
      disabled={disabled}
      title={keyLabel(id) ? `${label}（${keyLabel(id)}）` : label}
      onClick={() => runCommand(id)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {btn("file.open", <SquareArrowOutUpRight size={13} />, "開く")}
      {btn("file.quickLook", <Eye size={13} />, "Quick Look")}
      {btn("file.reveal", <FolderSearch size={13} />, "場所を表示", off || files.length > 1)}
      {btn("file.copyPath", <Copy size={13} />, "パスをコピー", false)}
    </div>
  );
}

/** 付いている数：全部に付いている（all）／一部にだけ（some）。 */
function tally(lists: number[][]): Map<number, "all" | "some"> {
  const n = new Map<number, number>();
  for (const l of lists) for (const id of l) n.set(id, (n.get(id) ?? 0) + 1);
  return new Map([...n].map(([id, c]) => [id, c === lists.length ? "all" : "some"]));
}

function Chip({ icon, label, some, onRemove, onAdd }: { icon: ReactNode; label: string; some: boolean; onRemove: () => void; onAdd?: () => void }) {
  return (
    <span
      className={`flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-1.5 ${some ? "border border-dashed border-edge text-dim" : "bg-control"}`}
      title={some ? "一部のファイルにだけ付いています。押すと全部に付けます" : undefined}
      onClick={some ? onAdd : undefined}
    >
      {icon}
      <span className="truncate">{label}</span>
      <button aria-label={`「${label}」を外す`} className="ghost rounded p-0.5" onClick={(e) => (e.stopPropagation(), onRemove())}>
        <X size={12} />
      </button>
    </span>
  );
}

function Tags({ files }: { files: FileRow[] }) {
  const tags = useStore((s) => s.tags);
  const setTag = useStore((s) => s.setTag);
  const addTag = useStore((s) => s.addTag);
  const [text, setText] = useState("");
  const ids = files.map((f) => f.id);
  const on = tally(files.map((f) => f.tags));
  const add = () => {
    const name = text.trim();
    if (!name) return;
    setText("");
    void addTag(ids, name);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold text-dim">タグ</div>
      <div className="flex flex-wrap gap-1">
        {tags
          .filter((t) => on.has(t.id))
          .map((t) => (
            <Chip
              key={t.id}
              icon={<TagIcon size={12} />}
              label={t.name}
              some={on.get(t.id) === "some"}
              onRemove={() => void setTag(ids, t.id, false)}
              onAdd={() => void setTag(ids, t.id, true)}
            />
          ))}
      </div>
      <input
        list="bindery-tags"
        value={text}
        placeholder="タグを付ける（Enter）"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === "Enter") add();
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        className="rounded-md border border-edge bg-field px-2 py-1 outline-none focus:border-accent"
      />
      <datalist id="bindery-tags">
        {tags
          .filter((t) => on.get(t.id) !== "all")
          .map((t) => (
            <option key={t.id} value={t.name} />
          ))}
      </datalist>
    </div>
  );
}

function Folders({ files }: { files: FileRow[] }) {
  const vfolders = useStore((s) => s.vfolders);
  const setFolder = useStore((s) => s.setFolder);
  const ids = files.map((f) => f.id);
  const on = tally(files.map((f) => f.folders));
  const choices = vfolders
    .filter((v) => on.get(v.id) !== "all")
    .map((v) => ({ id: v.id, path: folderPath(vfolders, v.id) }))
    .sort((a, b) => a.path.localeCompare(b.path, "ja"));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold text-dim">仮想フォルダ</div>
      <div className="flex flex-wrap gap-1">
        {vfolders
          .filter((v) => on.has(v.id))
          .map((v) => (
            <Chip
              key={v.id}
              icon={<Folder size={12} />}
              label={folderPath(vfolders, v.id)}
              some={on.get(v.id) === "some"}
              onRemove={() => void setFolder(ids, v.id, false)}
              onAdd={() => void setFolder(ids, v.id, true)}
            />
          ))}
      </div>
      {vfolders.length === 0 ? (
        <div className="text-[12px] text-dim">サイドバーの「仮想フォルダ」の＋で作れます</div>
      ) : (
        <select
          value=""
          onChange={(e) => e.target.value && void setFolder(ids, Number(e.target.value), true)}
          className="rounded-md border border-edge bg-field px-2 py-1 outline-none focus:border-accent"
        >
          <option value="">仮想フォルダに入れる…</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

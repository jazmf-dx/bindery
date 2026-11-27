/**
 * 詳細パネル（docs/CONCEPT.md「プレビュー」「サイドバー」）。選んだファイルの情報・タグ・仮想フォルダ・メモと、開く操作。
 * 複数を選んだときは、タグ・仮想フォルダの付け外しをまとめて行う（一部にだけ付いているものは薄く出す）。
 * メモは 1 件を選んだときだけ書ける。行方不明のファイルは、つなぎ直すか記録を外せる。
 * 小さなプレビューはあとで（CSP の判断と一緒に）。今はスペースで一覧の上に大きく出す（Preview.tsx）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Eye, FileText, FolderSearch, Folder, Link2, SquareArrowOutUpRight, Tag as TagIcon, Trash2, X } from "lucide-react";
import type { FileRow } from "../lib/api";
import { keyLabel, runCommand } from "../lib/commands";
import { composing } from "../lib/ime";
import { formatDate, formatSize, iconKindName, iconKindOf, kindLabel } from "../lib/kinds";
import { dragRegion } from "../lib/titleBar";
import { folderPath, useStore } from "../store";
import { placeOf } from "./FileList";
import { KindIcon } from "./KindIcon";

export function Details() {
  const files = useStore((s) => s.files);
  const selectedIds = useStore((s) => s.selected);
  const chosen = new Set(selectedIds);
  const selected = files.filter((f) => chosen.has(f.id));
  const single = selected.length === 1 ? selected[0] : null;
  return (
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-l border-line bg-panel" {...dragRegion()}>
      {selected.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-dim">
          <FileText size={28} strokeWidth={1.5} className="text-dim/70" />
          <div>ファイルを選ぶと、情報・タグ・仮想フォルダ・メモがここに出ます</div>
          <div>
            <kbd className="rounded border border-b-2 border-line bg-raised px-1.5 font-sans text-[11px] text-fg">スペース</kbd> でプレビュー
          </div>
        </div>
      ) : (
        <div className="flex flex-col px-4 pt-4 pb-5">
          {single ? <About file={single} /> : <AboutMany files={selected} />}
          {selected.every((f) => f.missing) && <MissingActions files={selected} />}
          <Actions files={selected} />
          <Heading>タグ</Heading>
          <Tags files={selected} />
          <Heading>仮想フォルダ</Heading>
          <Folders files={selected} />
          {single && (
            <>
              <Heading>メモ</Heading>
              <Note key={single.id} file={single} />
              <Heading>情報</Heading>
              <Info file={single} />
            </>
          )}
        </div>
      )}
    </aside>
  );
}

/** まとまりの小さな見出し（stockroom の詳細パネルと同じ）。 */
function Heading({ children }: { children: ReactNode }) {
  return <div className="mt-5 mb-1.5 text-[11px] font-semibold tracking-wide text-dim">{children}</div>;
}

/** 入力欄の見た目（タグ・仮想フォルダ・メモ）：面は沈め、枠はフォーカスしたときだけ。 */
const field = "rounded-md border border-transparent bg-ink/[0.06] px-2 outline-none placeholder:text-dim focus:border-accent";

/** 名前と、種類・大きさの 1 行。 */
function About({ file }: { file: FileRow }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <KindIcon ext={file.ext} size={36} />
        <div className="min-w-0 pt-0.5">
          <div className="text-[14px] leading-snug font-semibold break-all select-text">{file.name}</div>
          <div className="mt-0.5 text-[12px] text-dim tabular-nums">
            {kindLabel(file.ext)} · {formatSize(file.size)}
          </div>
        </div>
      </div>
      {file.missing && <div className="rounded-md bg-tonal px-2 py-1 text-[12px] text-on-tonal">行方不明：最後に見た場所にありません</div>}
    </div>
  );
}

/** 複数を選んだとき：件数と、種類ごとの数・合計の大きさ。 */
function AboutMany({ files }: { files: FileRow[] }) {
  const byKind = new Map<string, number>();
  for (const f of files) {
    const k = iconKindName(iconKindOf(f.ext));
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  return (
    <div>
      <div className="text-[14px] font-semibold tabular-nums">{files.length} 件を選択</div>
      <div className="mt-0.5 text-[12px] text-dim tabular-nums">
        {[...byKind].map(([k, n]) => `${k} ${n}`).join(" · ")} · 計 {formatSize(total)}
      </div>
    </div>
  );
}

/** ファイルの情報。場所は登録フォルダから（全体のパスは指したときと［パスをコピー］で）。 */
function Info({ file }: { file: FileRow }) {
  const roots = useStore((s) => s.roots);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
      <dt className="text-dim">種類</dt>
      <dd className="m-0">{kindLabel(file.ext)}</dd>
      <dt className="text-dim">大きさ</dt>
      <dd className="m-0 tabular-nums">{formatSize(file.size)}</dd>
      <dt className="text-dim">更新日</dt>
      <dd className="m-0 tabular-nums">{formatDate(file.mtime)}</dd>
      <dt className="text-dim">場所</dt>
      <dd className="m-0 min-w-0 break-all select-text" title={file.path}>
        {placeOf(roots, undefined, file)}
      </dd>
    </dl>
  );
}

/**
 * 開く操作。2 列 2 段の同じ大きさのボタン（パネルを狭めても名前が切れない）。
 * 行方不明だけのときは押せない（場所はそのまま、無効の見た目にする）。
 */
function Actions({ files }: { files: FileRow[] }) {
  const off = files.every((f) => f.missing);
  const btn = (id: string, icon: ReactNode, label: string, disabled = off) => (
    <button
      className="flex h-8 min-w-0 items-center gap-2 rounded-md bg-ink/[0.06] px-2.5 text-[12px] enabled:hover:bg-ink/10 enabled:active:bg-ink/15 disabled:off disabled:bg-transparent"
      disabled={disabled}
      title={keyLabel(id) ? `${label}（${keyLabel(id)}）` : label}
      onClick={() => runCommand(id)}
    >
      <span className="shrink-0 text-dim">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div className="mt-4 grid grid-cols-2 gap-1.5">
      {btn("file.open", <SquareArrowOutUpRight size={14} />, "開く")}
      {btn("file.quickLook", <Eye size={14} />, "プレビュー")}
      {btn("file.reveal", <FolderSearch size={14} />, "場所を表示", off || files.length > 1)}
      {btn("file.copyPath", <Copy size={14} />, "パスをコピー", false)}
    </div>
  );
}

/** 行方不明のファイル：今の場所へつなぎ直す（1 件のとき）・記録を外す。 */
function MissingActions({ files }: { files: FileRow[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {files.length === 1 && (
        <button
          className="flex h-7 items-center gap-1.5 rounded-md bg-accent-fill px-2.5 text-white hover:brightness-110"
          title="移した先のファイルを選んで、付けた情報ごとつなぎ直します"
          onClick={() => runCommand("file.relink")}
        >
          <Link2 size={13} />
          つなぎ直す…
        </button>
      )}
      <button
        className="flex h-7 items-center gap-1.5 rounded-md bg-ink/[0.06] px-2.5 hover:bg-ink/10"
        title="アプリの記録から消します。元のファイルには触りません"
        onClick={() => runCommand("file.forget")}
      >
        <Trash2 size={13} />
        記録を外す…
      </button>
    </div>
  );
}

/**
 * メモ。欄を離れたとき（ほかのファイルを選んだときも）に書く。
 * ファイルごとに作り直す（`key`）ので、書きかけが別のファイルへ移ることはない。
 */
function Note({ file }: { file: FileRow }) {
  const setNote = useStore((s) => s.setNote);
  const [text, setText] = useState(file.note);
  const draft = useRef(file.note);
  const saved = useRef(file.note);
  // ほかで書き換わったら（読み直したとき）合わせる。書きかけのときは上書きしない
  useEffect(() => {
    if (draft.current === saved.current) {
      setText(file.note);
      draft.current = file.note;
    }
    saved.current = file.note;
  }, [file.note]);
  const save = () => {
    if (draft.current === saved.current) return;
    saved.current = draft.current;
    void setNote(file.id, draft.current);
  };
  // 選ぶファイルが変わって欄が消えるときも書く
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(), []);
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={text}
        rows={4}
        placeholder="このファイルは何か、どの版が最新か…"
        title="アプリの中だけに残り、元のファイルには書きません"
        onChange={(e) => {
          setText(e.target.value);
          draft.current = e.target.value;
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className={`${field} resize-y py-1.5 leading-relaxed`}
      />
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
      className={`flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-1.5 ${some ? "border border-dashed border-edge text-dim" : "bg-ink/[0.08]"}`}
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
      <div className="flex flex-wrap gap-1 empty:hidden">
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
        className={`${field} h-8`}
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
      <div className="flex flex-wrap gap-1 empty:hidden">
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
        <div className="text-[12px] text-dim">サイドバーの「仮想フォルダ」の ＋ で作れます</div>
      ) : (
        <select
          value=""
          onChange={(e) => e.target.value && void setFolder(ids, Number(e.target.value), true)}
          className={`${field} h-8 text-dim`}
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

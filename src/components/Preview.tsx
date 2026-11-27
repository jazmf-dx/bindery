/**
 * スペースで開く、中身の確認（docs/CONCEPT.md「プレビュー」）。一覧の上に重ねて出す。
 * 選んでいる 1 つ目のファイルを出し、↑↓ で選びなおすとそのまま切り替わる。
 * PDF は画面の PDF 表示、Word・Excel・PowerPoint などは作ったプレビュー、テキストは先頭を読んだもの。
 * 閉じるのはスペース・Esc・×。選びなおしや場所を変えて何も選んでいなければ、自然に閉じる。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type FilePreview } from "../lib/api";
import { kindLabel } from "../lib/kinds";
import { composing } from "../lib/ime";
import { runCommand } from "../lib/commands";
import { useStore } from "../store";

/** asset プロトコルは 1 つの符号化したパスを受ける。フォルダの後ろにファイル名を足すと、ページの相対リンクがフォルダの中で効く。 */
function src(p: FilePreview): string {
  if (p.kind === "pdf") return convertFileSrc(p.path);
  if (p.kind === "html") return `${convertFileSrc(p.dir)}/${encodeURIComponent(p.file)}`;
  return "";
}

type Got = { id: number; preview: FilePreview | null } | { id: number; error: string };

export function Preview() {
  const open = useStore((s) => s.previewOpen);
  const file = useStore((s) => (s.dirFocus === null ? s.files.find((f) => f.id === s.selected[0]) : undefined));
  const close = useStore((s) => s.closePreview);
  const [got, setGot] = useState<Got>();
  const box = useRef<HTMLDivElement>(null);
  const id = file?.id;
  const shown = open ? id : undefined;

  // 何も選んでいない（場所を変えた・選びなおした）なら閉じる
  useEffect(() => {
    if (open && id === undefined) close();
  }, [open, id, close]);

  // 選んでいるファイルのプレビューを取る（文書は初回だけ作るので少しかかる）
  useEffect(() => {
    if (shown === undefined) return;
    let live = true;
    api.filePreview(shown).then(
      (preview) => live && setGot({ id: shown, preview }),
      (e) => live && setGot({ id: shown, error: String(e) }),
    );
    return () => {
      live = false;
    };
  }, [shown]);

  // Esc で閉じる（「選ぶのをやめる」に先に取られないよう、先に受ける）。開いたら枠へ焦点を移し、PDF の枠にキーを取られないようにする
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !composing(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open || !file) return null;
  const mine = got?.id === file.id ? got : undefined;
  const preview = mine && "preview" in mine ? mine.preview : undefined;
  const error = mine && "error" in mine ? mine.error : undefined;
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-label={`${file.name} のプレビュー`} className="absolute inset-0 z-30 flex flex-col bg-bg outline-none">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4" data-tauri-drag-region>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{file.name}</div>
          <div className="text-[11px] text-dim">{kindLabel(file.ext)}</div>
        </div>
        <button
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-hover active:bg-press"
          title="既定のアプリで開く"
          onClick={() => {
            runCommand("file.open");
          }}
        >
          <SquareArrowOutUpRight size={13} className="text-dim" />
          開く
        </button>
        <button className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover active:bg-press" title="閉じる（スペース・Esc）" aria-label="閉じる" onClick={close}>
          <X size={15} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Body preview={preview} error={error} name={file.name} />
      </div>
    </div>
  );
}

function Body({ preview, error, name }: { preview: FilePreview | null | undefined; error: string | undefined; name: string }) {
  if (error) return <Note>{error}</Note>;
  if (preview === undefined)
    return (
      <Note>
        <Loader2 size={15} className="animate-spin" />
        プレビューを作っています…
      </Note>
    );
  if (preview === null) return <Note>このファイルはプレビューできません。［開く］で既定のアプリで見られます。</Note>;
  if (preview.kind === "text")
    return (
      <div className="absolute inset-0 overflow-auto">
        <pre className="m-0 min-h-full p-5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">{preview.text}</pre>
        {preview.truncated && <div className="sticky bottom-0 bg-raised/90 px-5 py-1.5 text-[11px] text-dim">長いので、先頭だけを出しています。</div>}
      </div>
    );
  return (
    <iframe
      // HTML は Quick Look が作ったページ（表のタブの切り替えに自分のスクリプトを使う）。アプリには触れない
      key={src(preview)}
      src={src(preview)}
      title={name}
      sandbox={preview.kind === "html" ? "allow-scripts" : undefined}
      className="absolute inset-0 h-full w-full border-0 bg-white"
    />
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="absolute inset-0 flex items-center justify-center gap-2 p-10 text-center text-sm text-dim">{children}</div>
);

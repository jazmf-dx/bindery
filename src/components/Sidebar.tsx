/**
 * サイドバー。上から 未整理・行方不明 → 仮想フォルダ → タグ → 登録フォルダ（docs/CONCEPT.md「サイドバー」）。
 * 仮想フォルダとタグの行は、一覧からドラッグしたファイルの落とし先になる（`data-drop`、DragLayer.tsx）。
 */
import type { ReactNode } from "react";
import { Folder, FolderOpen, FolderPlus, HelpCircle, Inbox, Layers, Plus, Tag as TagIcon, X } from "lucide-react";
import type { Place, Root, Tag, VFolder } from "../lib/api";
import { runCommand } from "../lib/commands";
import { dragRegion } from "../lib/titleBar";
import { samePlace, useStore } from "../store";
import { HoverButton, NameInput, Section } from "./ui";

export function Sidebar() {
  const roots = useStore((s) => s.roots);
  const tags = useStore((s) => s.tags);
  const vfolders = useStore((s) => s.vfolders);
  const missingCount = useStore((s) => s.missingCount);
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const createTag = useStore((s) => s.createTag);
  const createFolder = useStore((s) => s.createFolder);

  return (
    <nav className="vibrant flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel px-2 pb-3" {...dragRegion(true)}>
      <div className="h-[var(--titlebar)] shrink-0" />
      <Section>
        <PlaceRow place={{ kind: "all" }} icon={<Layers size={15} />} label="すべてのファイル" />
        <PlaceRow place={{ kind: "unsorted" }} icon={<Inbox size={15} />} label="未整理" />
        <PlaceRow place={{ kind: "missing" }} icon={<HelpCircle size={15} />} label="行方不明" count={missingCount || undefined} />
      </Section>

      <Section
        title="仮想フォルダ"
        action={
          <button aria-label="新しい仮想フォルダ" title="新しい仮想フォルダ" className="ghost rounded p-0.5 text-dim" onClick={() => setEditing({ kind: "newFolder", parentId: null })}>
            <Plus size={13} />
          </button>
        }
      >
        <FolderTree parentId={null} depth={0} vfolders={vfolders} />
        {editing?.kind === "newFolder" && editing.parentId === null && (
          <NewRow
            icon={<Folder size={15} />}
            placeholder="仮想フォルダの名前"
            onDone={(name) => {
              setEditing(null);
              if (name) void createFolder(name, null);
            }}
          />
        )}
        {vfolders.length === 0 && editing?.kind !== "newFolder" && <Empty text="＋で作れます" />}
      </Section>

      <Section
        title="タグ"
        action={
          <button aria-label="新しいタグ" title="新しいタグ" className="ghost rounded p-0.5 text-dim" onClick={() => setEditing({ kind: "newTag" })}>
            <Plus size={13} />
          </button>
        }
      >
        {tags.map((t) => (
          <TagRow key={t.id} tag={t} />
        ))}
        {editing?.kind === "newTag" && (
          <NewRow
            icon={<TagIcon size={15} />}
            placeholder="タグの名前"
            onDone={(name) => {
              setEditing(null);
              if (name) void createTag(name);
            }}
          />
        )}
        {tags.length === 0 && editing?.kind !== "newTag" && <Empty text="詳細パネルか＋で作れます" />}
      </Section>

      <Section title="登録フォルダ">
        {roots.map((r) => (
          <RootRow key={r.id} root={r} />
        ))}
        <Row icon={<FolderPlus size={15} />} label="フォルダを登録…" dim onClick={() => runCommand("folder.add")} />
      </Section>
    </nav>
  );
}

type RowProps = {
  icon: ReactNode;
  label: ReactNode;
  count?: number;
  title?: string;
  active?: boolean;
  dim?: boolean;
  depth?: number;
  drop?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  trailing?: ReactNode;
};

function Row({ icon, label, count, title, active, dim, depth = 0, drop, onClick, onDoubleClick, trailing }: RowProps) {
  return (
    <div
      role="button"
      title={title}
      data-drop={drop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`group flex cursor-default items-center gap-2 rounded-md py-1 pr-1.5 data-[over]:!bg-tonal data-[over]:!text-on-tonal ${active ? "bg-chosen" : "ghost"} ${dim ? "text-dim" : ""}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] text-dim tabular-nums">{count}</span>}
      {/* 件数の右の場所は、ボタンが無い行でも同じ幅を空けておく */}
      <span className="flex min-w-[18px] justify-end">{trailing}</span>
    </div>
  );
}

function PlaceRow({ place, ...rest }: { place: Place } & Omit<RowProps, "active" | "onClick">) {
  const current = useStore((s) => s.place);
  const go = useStore((s) => s.go);
  return <Row {...rest} active={samePlace(place, current)} onClick={() => go(place)} />;
}

function NewRow({ icon, placeholder, depth = 0, onDone }: { icon: ReactNode; placeholder: string; depth?: number; onDone: (name: string | null) => void }) {
  return <Row icon={icon} depth={depth} label={<NameInput placeholder={placeholder} onDone={onDone} />} />;
}

function Empty({ text }: { text: string }) {
  return <div className="px-2 text-[12px] text-dim">{text}</div>;
}

function FolderTree({ parentId, depth, vfolders }: { parentId: number | null; depth: number; vfolders: VFolder[] }) {
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const createFolder = useStore((s) => s.createFolder);
  return (
    <>
      {vfolders
        .filter((v) => v.parentId === parentId)
        .map((v) => (
          <div key={v.id} className="contents">
            <FolderRow folder={v} depth={depth} hasChildren={vfolders.some((c) => c.parentId === v.id)} />
            <FolderTree parentId={v.id} depth={depth + 1} vfolders={vfolders} />
            {editing?.kind === "newFolder" && editing.parentId === v.id && (
              <NewRow
                icon={<Folder size={15} />}
                depth={depth + 1}
                placeholder="仮想フォルダの名前"
                onDone={(name) => {
                  setEditing(null);
                  if (name) void createFolder(name, v.id);
                }}
              />
            )}
          </div>
        ))}
    </>
  );
}

function FolderRow({ folder, depth, hasChildren }: { folder: VFolder; depth: number; hasChildren: boolean }) {
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const renameFolder = useStore((s) => s.renameFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const place: Place = { kind: "folder", id: folder.id };
  const renaming = editing?.kind === "folder" && editing.id === folder.id;
  return (
    <PlaceRow
      place={place}
      depth={depth}
      drop={`folder:${folder.id}`}
      icon={hasChildren ? <FolderOpen size={15} /> : <Folder size={15} />}
      label={
        renaming ? (
          <NameInput
            initial={folder.name}
            onDone={(name) => {
              setEditing(null);
              if (name && name !== folder.name) void renameFolder(folder.id, name);
            }}
          />
        ) : (
          folder.name
        )
      }
      count={folder.count || undefined}
      onDoubleClick={() => setEditing({ kind: "folder", id: folder.id })}
      trailing={
        <span className="flex">
          <HoverButton label="中に仮想フォルダを作る" onClick={() => setEditing({ kind: "newFolder", parentId: folder.id })}>
            <FolderPlus size={13} />
          </HoverButton>
          <HoverButton label="仮想フォルダを消す（ファイルはそのまま）" onClick={() => void deleteFolder(folder.id)}>
            <X size={13} />
          </HoverButton>
        </span>
      }
    />
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const renameTag = useStore((s) => s.renameTag);
  const deleteTag = useStore((s) => s.deleteTag);
  const renaming = editing?.kind === "tag" && editing.id === tag.id;
  return (
    <PlaceRow
      place={{ kind: "tag", id: tag.id }}
      drop={`tag:${tag.id}`}
      icon={<TagIcon size={15} />}
      label={
        renaming ? (
          <NameInput
            initial={tag.name}
            onDone={(name) => {
              setEditing(null);
              if (name && name !== tag.name) void renameTag(tag.id, name);
            }}
          />
        ) : (
          tag.name
        )
      }
      count={tag.count || undefined}
      onDoubleClick={() => setEditing({ kind: "tag", id: tag.id })}
      trailing={
        <HoverButton label="タグを消す（ファイルからも外れる）" onClick={() => void deleteTag(tag.id)}>
          <X size={13} />
        </HoverButton>
      }
    />
  );
}

function RootRow({ root }: { root: Root }) {
  const removeRoot = useStore((s) => s.removeRoot);
  return (
    <PlaceRow
      place={{ kind: "root", id: root.id }}
      icon={<Folder size={15} />}
      label={root.name}
      title={root.path}
      count={root.count}
      trailing={
        <HoverButton label="登録を外す（元のファイルには触りません）" onClick={() => void removeRoot(root.id)}>
          <X size={13} />
        </HoverButton>
      }
    />
  );
}

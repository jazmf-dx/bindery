/**
 * サイドバー。上から 最近の変更・未整理・行方不明 → 仮想フォルダ → タグ → 登録フォルダ（docs/CONCEPT.md「サイドバー」）。
 * 仮想フォルダとタグの行は、一覧からドラッグしたファイルの落とし先になる（`data-drop`、DragLayer.tsx）。
 * 登録フォルダの下には、中のフォルダを元の階層のまま木で出す（開け閉めできる。はじめは閉じている）。
 * 仮想フォルダの行はドラッグで別の仮想フォルダの下へ（「仮想フォルダ」の見出しへ落とすと一番上へ）移せる。
 * 行を右クリックすると OS のメニューを出す（contextMenu.ts）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderOpen, FolderPlus, HelpCircle, History, Inbox, Layers, Plus, Tag as TagIcon, X } from "lucide-react";
import type { Dir, Place, Root, Tag, VFolder } from "../lib/api";
import { command, runCommand } from "../lib/commands";
import { openMenu, type Entry } from "../lib/contextMenu";
import { dragRegion } from "../lib/titleBar";
import { samePlace, useStore } from "../store";
import { HoverButton, NameInput, Section } from "./ui";

export function Sidebar() {
  const roots = useStore((s) => s.roots);
  const tags = useStore((s) => s.tags);
  const vfolders = useStore((s) => s.vfolders);
  const missingCount = useStore((s) => s.missingCount);
  const recentCount = useStore((s) => s.recentCount);
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const createTag = useStore((s) => s.createTag);
  const createFolder = useStore((s) => s.createFolder);

  return (
    <nav className="vibrant flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel px-2 pb-3" {...dragRegion(true)}>
      <div className="h-[var(--titlebar)] shrink-0" />
      <Section>
        <PlaceRow place={{ kind: "all" }} icon={<Layers size={15} />} label="すべてのファイル" />
        <PlaceRow
          place={{ kind: "recent" }}
          icon={<History size={15} />}
          label="最近の変更"
          title="この 7 日のあいだに中身が変わったファイルと、増えたファイル"
          count={recentCount || undefined}
        />
        <PlaceRow place={{ kind: "unsorted" }} icon={<Inbox size={15} />} label="未整理" />
        <PlaceRow place={{ kind: "missing" }} icon={<HelpCircle size={15} />} label="行方不明" count={missingCount || undefined} />
      </Section>

      <Section
        title="仮想フォルダ"
        drop="folder:top"
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
  /** アイコンの前に置く開け閉めの印（登録フォルダの木）。 */
  twisty?: ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  /** 右クリックのメニューの中身。 */
  menu?: () => Entry[];
  trailing?: ReactNode;
};

function Row({ icon, label, count, title, active, dim, depth = 0, drop, twisty, onClick, onDoubleClick, onMouseDown, menu, trailing }: RowProps) {
  return (
    <div
      role="button"
      title={title}
      data-drop={drop}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onContextMenu={menu ? (e) => openMenu(e, menu) : undefined}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={`group flex cursor-default items-center gap-2 rounded-md py-1 pr-1.5 data-[over]:!bg-tonal data-[over]:!text-on-tonal ${active ? "bg-chosen" : "ghost"} ${dim ? "text-dim" : ""}`}
    >
      {twisty}
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

/**
 * 仮想フォルダの行のドラッグ。押したまま 4px 動いたら始める（一覧の行と同じ作り：FileList.tsx `startDrag`）。
 * 名前を打ち込んでいる欄の中では始めない。
 */
function startFolderDrag(e: React.MouseEvent, folder: VFolder) {
  if (e.button !== 0 || (e.target as HTMLElement).closest("input, button")) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const move = (m: MouseEvent) => {
    if (Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
    stop();
    useStore.getState().setDrag({ ids: [], folder: folder.id, x: m.clientX, y: m.clientY, label: folder.name });
  };
  const stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", stop);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);
}

function FolderRow({ folder, depth, hasChildren }: { folder: VFolder; depth: number; hasChildren: boolean }) {
  const editing = useStore((s) => s.editing);
  const setEditing = useStore((s) => s.setEditing);
  const renameFolder = useStore((s) => s.renameFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const moveFolder = useStore((s) => s.moveFolder);
  const place: Place = { kind: "folder", id: folder.id };
  const renaming = editing?.kind === "folder" && editing.id === folder.id;
  return (
    <PlaceRow
      place={place}
      depth={depth}
      drop={`folder:${folder.id}`}
      onMouseDown={(e) => startFolderDrag(e, folder)}
      menu={() => [
        { label: "中に仮想フォルダを作る", run: () => setEditing({ kind: "newFolder", parentId: folder.id }) },
        { label: "名前を変える", run: () => setEditing({ kind: "folder", id: folder.id }) },
        ...(folder.parentId !== null ? [{ label: "一番上へ移す", run: () => void moveFolder(folder.id, null) }] : []),
        "-",
        { label: "仮想フォルダを消す…", run: () => void deleteFolder(folder.id) },
      ]}
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
      menu={() => [
        { label: "名前を変える", run: () => setEditing({ kind: "tag", id: tag.id }) },
        "-",
        { label: "タグを消す…", run: () => void deleteTag(tag.id) },
      ]}
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

/** 登録フォルダ・中のフォルダの右クリックのメニュー。 */
export function rootMenu(root: Root, dir: string): Entry[] {
  const st = useStore.getState();
  return [
    { label: command("folder.reveal").label, run: () => st.revealRoot(root.id, dir) },
    { label: command("folder.rescan").label, run: () => runCommand("folder.rescan") },
    ...(dir ? [] : ["-" as const, { label: "登録を外す…", run: () => void st.removeRoot(root.id) }]),
  ];
}

function RootRow({ root }: { root: Root }) {
  const removeRoot = useStore((s) => s.removeRoot);
  const [open, setOpen] = useOpenToPlace(root.id, "");
  const top = root.dirs.filter((d) => !d.path.includes("/"));
  return (
    <>
      <PlaceRow
        place={{ kind: "root", id: root.id, dir: "" }}
        icon={<Folder size={15} />}
        twisty={<Twisty has={top.length > 0} open={open} onToggle={() => setOpen(!open)} />}
        menu={() => rootMenu(root, "")}
        label={root.name}
        title={root.recursive ? root.path : `${root.path}（サブフォルダは読まない）`}
        // 一覧と同じく、直接入っているファイルの数（中のフォルダの分は、その行に出る）
        count={root.count - root.dirs.reduce((n, d) => n + d.count, 0) || undefined}
        trailing={
          <HoverButton label="登録を外す（元のファイルには触りません）" onClick={() => void removeRoot(root.id)}>
            <X size={13} />
          </HoverButton>
        }
      />
      {open && top.map((d) => <DirRow key={d.path} root={root} dir={d} depth={1} />)}
    </>
  );
}

/** 登録フォルダの中のフォルダ。選ぶと、そのフォルダに直接入っているファイルが出る。 */
function DirRow({ root, dir, depth }: { root: Root; dir: Dir; depth: number }) {
  const [open, setOpen] = useOpenToPlace(root.id, dir.path);
  const children = root.dirs.filter((d) => d.path.startsWith(`${dir.path}/`) && !d.path.slice(dir.path.length + 1).includes("/"));
  return (
    <>
      <PlaceRow
        place={{ kind: "root", id: root.id, dir: dir.path }}
        depth={depth}
        icon={<Folder size={15} />}
        twisty={<Twisty has={children.length > 0} open={open} onToggle={() => setOpen(!open)} />}
        menu={() => rootMenu(root, dir.path)}
        label={dir.path.slice(dir.path.lastIndexOf("/") + 1)}
        title={dir.path}
        count={dir.count || undefined}
      />
      {open && children.map((d) => <DirRow key={d.path} root={root} dir={d} depth={depth + 1} />)}
    </>
  );
}

/**
 * 木の開け閉め（はじめは閉じている）。一覧のフォルダの行から下へ入ったときは、
 * 今の場所が見えるよう、その上の行を開く。
 */
function useOpenToPlace(rootId: number, path: string) {
  const [open, setOpen] = useState(false);
  const inside = useStore((s) => s.place.kind === "root" && s.place.id === rootId && s.place.dir.startsWith(path ? `${path}/` : "") && s.place.dir !== path);
  useEffect(() => {
    if (inside) setOpen(true);
  }, [inside]);
  return [open, setOpen] as const;
}

/** 開け閉めの印。中のフォルダが無い行も、同じ幅を空けて名前の位置をそろえる。 */
function Twisty({ has, open, onToggle }: { has: boolean; open: boolean; onToggle: () => void }) {
  if (!has) return <span className="-mr-1.5 w-3.5 shrink-0" />;
  return (
    <button
      aria-label={open ? "閉じる" : "開く"}
      aria-expanded={open}
      className="-mr-1.5 flex w-3.5 shrink-0 items-center justify-center text-dim"
      onClick={(e) => {
        // 行を選ぶ操作にしない
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
    </button>
  );
}

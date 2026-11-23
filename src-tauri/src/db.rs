//! アプリのデータ（`app_data_dir()` の `bindery.db`）。元のファイルには書かない
//! （docs/CONCEPT.md「ファイルの持ち方」）。ここにあるのは登録フォルダ、
//! その中で見つけたファイルの記録（照合のための ID・ハッシュを含む）、タグと仮想フォルダ。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

/// 版を上げるときは `migrate` に手順を足す（消さない・書き換えない）。
const SCHEMA: &[&str] = &[
    // 1: 登録フォルダとファイル
    "CREATE TABLE roots (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        file_id TEXT,
        hash TEXT,
        missing INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL
    );
    CREATE INDEX files_root ON files(root_id);
    CREATE INDEX files_file_id ON files(file_id);
    CREATE INDEX files_hash ON files(hash);",
    // 2: タグと仮想フォルダ。ファイルの行が消えると、付いていたものも外れる
    "CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE file_tags (
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (file_id, tag_id)
    );
    CREATE INDEX file_tags_tag ON file_tags(tag_id);
    CREATE TABLE vfolders (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES vfolders(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL
    );
    CREATE TABLE vfolder_files (
        vfolder_id INTEGER NOT NULL REFERENCES vfolders(id) ON DELETE CASCADE,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY (vfolder_id, file_id)
    );
    CREATE INDEX vfolder_files_file ON vfolder_files(file_id);",
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    setup(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    setup(Connection::open_in_memory()?)
}

fn setup(mut conn: Connection) -> rusqlite::Result<Connection> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, step) in SCHEMA.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(step)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: i64,
    pub path: String,
    /// 表示用の名前（パスの最後）。
    pub name: String,
    /// 中のファイルの数（行方不明を含まない）。
    pub count: i64,
    pub missing: i64,
}

pub fn list_roots(conn: &Connection) -> rusqlite::Result<Vec<Root>> {
    let mut st = conn.prepare(
        "SELECT r.id, r.path,
            (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.missing = 0),
            (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.missing = 1)
         FROM roots r",
    )?;
    let mut roots = st
        .query_map([], |r| {
            let path: String = r.get(1)?;
            Ok(Root {
                id: r.get(0)?,
                name: display_name(&path),
                path,
                count: r.get(2)?,
                missing: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    roots.sort_by_key(|r| r.name.to_lowercase());
    Ok(roots)
}

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub fn root_path(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT path FROM roots WHERE id = ?1", [id], |r| r.get(0))
        .optional()
}

pub fn insert_root(conn: &Connection, path: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO roots (path, added_at) VALUES (?1, ?2)",
        params![path, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// 登録を外す。そのフォルダのファイルの行も消える（`ON DELETE CASCADE`）。元のファイルには触らない。
pub fn delete_root(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM roots WHERE id = ?1", [id])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub id: i64,
    pub root_id: i64,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    /// 更新日時（ミリ秒）。
    pub mtime: i64,
    pub missing: bool,
    /// 付いているタグの id。
    pub tags: Vec<i64>,
    /// 入っている仮想フォルダの id。
    pub folders: Vec<i64>,
}

/// 一覧に出すもの。サイドバーの項目に対応する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Place {
    /// すべてのファイル（行方不明を除く）
    All,
    /// タグも仮想フォルダも無いもの
    Unsorted,
    Missing,
    /// 登録フォルダの中
    Root {
        id: i64,
    },
    Tag {
        id: i64,
    },
    /// 仮想フォルダに直接入っているもの（下の仮想フォルダの中身は含めない。Finder のフォルダと同じ）
    Folder {
        id: i64,
    },
}

fn ids(list: Option<String>) -> Vec<i64> {
    list.map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
        .unwrap_or_default()
}

pub fn list_files(conn: &Connection, place: Place) -> rusqlite::Result<Vec<FileRow>> {
    let (filter, id) = match place {
        Place::All => ("f.missing = 0", None),
        Place::Unsorted => (
            "f.missing = 0
             AND NOT EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id)",
            None,
        ),
        Place::Missing => ("f.missing = 1", None),
        Place::Root { id } => ("f.missing = 0 AND f.root_id = ?1", Some(id)),
        // タグ・仮想フォルダでは、行方不明のものも出す（付けた情報は残っているので）
        Place::Tag { id } => (
            "EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id AND t.tag_id = ?1)",
            Some(id),
        ),
        Place::Folder { id } => (
            "EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id AND v.vfolder_id = ?1)",
            Some(id),
        ),
    };
    let sql = format!(
        "SELECT f.id, f.root_id, f.path, f.name, f.ext, f.size, f.mtime, f.missing,
            (SELECT GROUP_CONCAT(tag_id) FROM file_tags WHERE file_id = f.id),
            (SELECT GROUP_CONCAT(vfolder_id) FROM vfolder_files WHERE file_id = f.id)
         FROM files f WHERE {filter}
         ORDER BY f.name COLLATE NOCASE, f.path"
    );
    let mut st = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row| {
        Ok(FileRow {
            id: r.get(0)?,
            root_id: r.get(1)?,
            path: r.get(2)?,
            name: r.get(3)?,
            ext: r.get(4)?,
            size: r.get(5)?,
            mtime: r.get(6)?,
            missing: r.get::<_, i64>(7)? != 0,
            tags: ids(r.get(8)?),
            folders: ids(r.get(9)?),
        })
    };
    let rows = match id {
        Some(id) => st.query_map([id], map)?.collect(),
        None => st.query_map([], map)?.collect(),
    };
    rows
}

/// そのファイルたちのパス（開く・Finder で表示・Quick Look 用）。行方不明のものは除く。
pub fn paths_of(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<String>> {
    let mut st = conn.prepare("SELECT path FROM files WHERE id = ?1 AND missing = 0")?;
    let mut out = Vec::new();
    for id in ids {
        if let Some(p) = st.query_row([id], |r| r.get(0)).optional()? {
            out.push(p);
        }
    }
    Ok(out)
}

/// タグ・仮想フォルダが付いたファイルの数（登録を外す前の確認用）。
pub fn organized_count(conn: &Connection, root_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM files f WHERE f.root_id = ?1 AND (
            EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id)
            OR EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id))",
        [root_id],
        |r| r.get(0),
    )
}

// ------------------------------------------------------------------ タグ

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

pub fn list_tags(conn: &Connection) -> rusqlite::Result<Vec<Tag>> {
    let mut st = conn.prepare(
        "SELECT t.id, t.name, (SELECT COUNT(*) FROM file_tags ft WHERE ft.tag_id = t.id)
         FROM tags t ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
            })
        })?
        .collect();
    rows
}

/// その名前のタグ（大文字・小文字は区別しない）。無ければ作る。
pub fn ensure_tag(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    if let Some(id) = conn
        .query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO tags (name, added_at) VALUES (?1, ?2)",
        params![name, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// 名前を変える。同じ名前のタグがあれば、そちらにまとめる。
pub fn rename_tag(conn: &mut Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let other: Option<i64> = tx
        .query_row(
            "SELECT id FROM tags WHERE name = ?1 AND id != ?2",
            params![name, id],
            |r| r.get(0),
        )
        .optional()?;
    match other {
        Some(other) => {
            tx.execute(
                "INSERT OR IGNORE INTO file_tags (file_id, tag_id)
                 SELECT file_id, ?2 FROM file_tags WHERE tag_id = ?1",
                params![id, other],
            )?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [id])?;
        }
        None => {
            tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, name])?;
        }
    }
    tx.commit()
}

pub fn delete_tag(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

pub fn tag_files(
    conn: &mut Connection,
    file_ids: &[i64],
    tag_id: i64,
    on: bool,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for f in file_ids {
        if on {
            tx.execute(
                "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                params![f, tag_id],
            )?;
        } else {
            tx.execute(
                "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
                params![f, tag_id],
            )?;
        }
    }
    tx.commit()
}

// ------------------------------------------------------------ 仮想フォルダ

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VFolder {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    /// 直接入っているファイルの数。
    pub count: i64,
}

pub fn list_vfolders(conn: &Connection) -> rusqlite::Result<Vec<VFolder>> {
    let mut st = conn.prepare(
        "SELECT v.id, v.name, v.parent_id,
            (SELECT COUNT(*) FROM vfolder_files vf WHERE vf.vfolder_id = v.id)
         FROM vfolders v ORDER BY v.name COLLATE NOCASE",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(VFolder {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                count: r.get(3)?,
            })
        })?
        .collect();
    rows
}

pub fn create_vfolder(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO vfolders (name, parent_id, added_at) VALUES (?1, ?2, ?3)",
        params![name, parent_id, now_ms()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_vfolder(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE vfolders SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    Ok(())
}

/// 消す。下の仮想フォルダも消える。中のファイル（元のファイル・記録）はそのまま。
pub fn delete_vfolder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM vfolders WHERE id = ?1", [id])?;
    Ok(())
}

/// 別の仮想フォルダの下へ移す（None は一番上）。自分の下へは移せない（false を返す）。
pub fn move_vfolder(conn: &Connection, id: i64, parent_id: Option<i64>) -> rusqlite::Result<bool> {
    let mut at = parent_id;
    while let Some(p) = at {
        if p == id {
            return Ok(false);
        }
        at = conn
            .query_row("SELECT parent_id FROM vfolders WHERE id = ?1", [p], |r| {
                r.get(0)
            })
            .optional()?
            .flatten();
    }
    conn.execute(
        "UPDATE vfolders SET parent_id = ?2 WHERE id = ?1",
        params![id, parent_id],
    )?;
    Ok(true)
}

pub fn file_into_vfolder(
    conn: &mut Connection,
    file_ids: &[i64],
    vfolder_id: i64,
    on: bool,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for f in file_ids {
        if on {
            tx.execute(
                "INSERT OR IGNORE INTO vfolder_files (vfolder_id, file_id) VALUES (?1, ?2)",
                params![vfolder_id, f],
            )?;
        } else {
            tx.execute(
                "DELETE FROM vfolder_files WHERE vfolder_id = ?1 AND file_id = ?2",
                params![vfolder_id, f],
            )?;
        }
    }
    tx.commit()
}

/// 行 `from` に付いていたタグ・仮想フォルダを、行 `to` にも付ける（照合でつなぎ直すとき）。
pub fn copy_organization(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO file_tags (file_id, tag_id) SELECT ?2, tag_id FROM file_tags WHERE file_id = ?1",
        params![from, to],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO vfolder_files (vfolder_id, file_id) SELECT vfolder_id, ?2 FROM vfolder_files WHERE file_id = ?1",
        params![from, to],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_once() {
        let conn = open_in_memory().unwrap();
        let v = conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap() as usize;
        assert_eq!(v, SCHEMA.len());
    }

    #[test]
    fn removing_a_root_removes_its_rows() {
        let conn = open_in_memory().unwrap();
        let id = insert_root(&conn, "/tmp/a").unwrap();
        conn.execute(
            "INSERT INTO files (root_id, path, name, ext, size, mtime, added_at)
             VALUES (?1, '/tmp/a/x.pdf', 'x.pdf', 'pdf', 1, 1, 1)",
            [id],
        )
        .unwrap();
        delete_root(&conn, id).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    fn with_files(n: i64) -> (Connection, Vec<i64>) {
        let conn = open_in_memory().unwrap();
        let root = insert_root(&conn, "/r").unwrap();
        let mut ids = Vec::new();
        for i in 0..n {
            conn.execute(
                "INSERT INTO files (root_id, path, name, ext, size, mtime, added_at)
                 VALUES (?1, ?2, ?3, 'pdf', 1, 1, 1)",
                params![root, format!("/r/{i}.pdf"), format!("{i}.pdf")],
            )
            .unwrap();
            ids.push(conn.last_insert_rowid());
        }
        (conn, ids)
    }

    fn names(conn: &Connection, place: Place) -> Vec<String> {
        list_files(conn, place)
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect()
    }

    #[test]
    fn tags_and_folders_take_files_out_of_unsorted() {
        let (mut conn, ids) = with_files(3);
        let tag = ensure_tag(&conn, "契約").unwrap();
        assert_eq!(ensure_tag(&conn, "契約").unwrap(), tag);
        tag_files(&mut conn, &ids[0..1], tag, true).unwrap();
        let folder = create_vfolder(&conn, "案件A", None).unwrap();
        file_into_vfolder(&mut conn, &ids[1..2], folder, true).unwrap();
        assert_eq!(names(&conn, Place::Unsorted), ["2.pdf"]);
        assert_eq!(names(&conn, Place::Tag { id: tag }), ["0.pdf"]);
        assert_eq!(names(&conn, Place::Folder { id: folder }), ["1.pdf"]);
        let f0 = &list_files(&conn, Place::All).unwrap()[0];
        assert_eq!((f0.tags.clone(), f0.folders.clone()), (vec![tag], vec![]));
        tag_files(&mut conn, &ids[0..1], tag, false).unwrap();
        assert_eq!(names(&conn, Place::Unsorted), ["0.pdf", "2.pdf"]);
    }

    #[test]
    fn renaming_a_tag_onto_another_merges_them() {
        let (mut conn, ids) = with_files(2);
        let a = ensure_tag(&conn, "a").unwrap();
        let b = ensure_tag(&conn, "b").unwrap();
        tag_files(&mut conn, &ids[0..1], a, true).unwrap();
        tag_files(&mut conn, &ids[1..2], b, true).unwrap();
        rename_tag(&mut conn, a, "B").unwrap();
        let tags = list_tags(&conn).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!((tags[0].id, tags[0].count), (b, 2));
    }

    #[test]
    fn deleting_a_folder_deletes_its_subfolders_but_not_files() {
        let (mut conn, ids) = with_files(1);
        let top = create_vfolder(&conn, "top", None).unwrap();
        let sub = create_vfolder(&conn, "sub", Some(top)).unwrap();
        file_into_vfolder(&mut conn, &ids, sub, true).unwrap();
        delete_vfolder(&conn, top).unwrap();
        assert!(list_vfolders(&conn).unwrap().is_empty());
        assert_eq!(names(&conn, Place::Unsorted), ["0.pdf"]);
    }

    #[test]
    fn a_folder_cannot_move_under_itself() {
        let conn = open_in_memory().unwrap();
        let top = create_vfolder(&conn, "top", None).unwrap();
        let sub = create_vfolder(&conn, "sub", Some(top)).unwrap();
        assert!(!move_vfolder(&conn, top, Some(sub)).unwrap());
        assert!(!move_vfolder(&conn, top, Some(top)).unwrap());
        assert!(move_vfolder(&conn, sub, None).unwrap());
    }
}

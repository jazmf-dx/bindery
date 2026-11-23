//! アプリのデータ（`app_data_dir()` の `bindery.db`）。元のファイルには書かない
//! （docs/CONCEPT.md「ファイルの持ち方」）。ここにあるのは登録フォルダと、
//! その中で見つけたファイルの記録（照合のための ID・ハッシュを含む）だけ。

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
}

/// 一覧に出すもの。サイドバーの項目に対応する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum View {
    /// すべてのファイル（行方不明を除く）
    All,
    /// タグも仮想フォルダも無いもの。まだタグが無いので、今は「すべて」と同じ
    Unsorted,
    Missing,
}

pub fn list_files(
    conn: &Connection,
    view: View,
    root_id: Option<i64>,
) -> rusqlite::Result<Vec<FileRow>> {
    let missing = matches!(view, View::Missing) as i64;
    let mut st = conn.prepare(
        "SELECT id, root_id, path, name, ext, size, mtime, missing FROM files
         WHERE missing = ?1 AND (?2 IS NULL OR root_id = ?2)
         ORDER BY name COLLATE NOCASE, path",
    )?;
    let rows = st
        .query_map(params![missing, root_id], |r| {
            Ok(FileRow {
                id: r.get(0)?,
                root_id: r.get(1)?,
                path: r.get(2)?,
                name: r.get(3)?,
                ext: r.get(4)?,
                size: r.get(5)?,
                mtime: r.get(6)?,
                missing: r.get::<_, i64>(7)? != 0,
            })
        })?
        .collect();
    rows
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
}

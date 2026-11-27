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
    // 3: 登録フォルダごとにサブフォルダまで読むか（前からのフォルダは読む）と、
    //    ファイルがどの中のフォルダにあるか（登録フォルダからの相対、区切りは `/`、直下は空）。
    //    `dir` は次の読み込み（起動時）で埋まる
    "ALTER TABLE roots ADD COLUMN recursive INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE files ADD COLUMN dir TEXT;
    CREATE INDEX files_dir ON files(root_id, dir);",
    // 4: メモと、アプリが変化に気付いた日時と中身（`new` 新しく増えた／`updated` 中身が変わった）。
    //    `scanned` は登録してから 1 度読んだか（最初の読み込みで見つけたものは「増えた」に入れない）。
    //    前からの登録フォルダは読んであるので 1
    "ALTER TABLE roots ADD COLUMN scanned INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE files ADD COLUMN note TEXT NOT NULL DEFAULT '';
    ALTER TABLE files ADD COLUMN changed_at INTEGER;
    ALTER TABLE files ADD COLUMN change_kind TEXT;
    CREATE INDEX files_changed ON files(changed_at);",
];

/// 「最近の変更」に出す日数（docs/CONCEPT.md「最近の変更」）。設定画面ができるまでは固定。
pub const RECENT_DAYS: i64 = 7;

/// 登録してからこの間に見つけたものは「新しく増えた」に入れない（ミリ秒）。
/// 同期フォルダ（DirectCloud など）は、登録の直後は一部のファイルしか見えず、あとから残りが現れるため。
pub const NEW_GRACE_MS: i64 = 24 * 3_600_000;

/// 「最近の変更」に出すものの下限（気付いた日時、ミリ秒）。
pub fn recent_since() -> i64 {
    now_ms() - RECENT_DAYS * 86_400_000
}

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
    /// 「最近の変更」に出るファイルの数。
    pub recent: i64,
    /// サブフォルダの中まで読むか（登録するときに選ぶ）。
    pub recursive: bool,
    /// 中のフォルダ（サイドバーの木）。扱うファイルが下のどこかにあるものだけ。名前の順。
    pub dirs: Vec<Dir>,
}

/// 登録フォルダの中のフォルダ。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dir {
    /// 登録フォルダからの相対（区切りは `/`）。
    pub path: String,
    /// 直下のファイルの数（行方不明を含まない）。
    pub count: i64,
}

pub fn list_roots(conn: &Connection) -> rusqlite::Result<Vec<Root>> {
    let mut st = conn.prepare(
        "SELECT r.id, r.path, r.recursive,
            (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.missing = 0),
            (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.missing = 1),
            (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id AND f.missing = 0 AND f.changed_at >= ?1)
         FROM roots r",
    )?;
    let mut roots = st
        .query_map([recent_since()], |r| {
            let path: String = r.get(1)?;
            Ok(Root {
                id: r.get(0)?,
                name: display_name(&path),
                path,
                recursive: r.get::<_, i64>(2)? != 0,
                count: r.get(3)?,
                missing: r.get(4)?,
                recent: r.get(5)?,
                dirs: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for root in &mut roots {
        root.dirs = list_dirs(conn, root.id)?;
    }
    roots.sort_by_key(|r| r.name.to_lowercase());
    Ok(roots)
}

/// 登録フォルダの中のフォルダ。ファイルが直接入っていないフォルダも、下にあれば出す（木をつなぐため）。
fn list_dirs(conn: &Connection, root_id: i64) -> rusqlite::Result<Vec<Dir>> {
    let mut st = conn.prepare(
        "SELECT dir, COUNT(*) FROM files
         WHERE root_id = ?1 AND missing = 0 AND dir IS NOT NULL AND dir != ''
         GROUP BY dir",
    )?;
    let mut counts: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for row in st.query_map([root_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })? {
        let (dir, n) = row?;
        // 上のフォルダも木に入れる
        let mut at = dir.as_str();
        while let Some(cut) = at.rfind('/') {
            at = &at[..cut];
            counts.entry(at.to_string()).or_insert(0);
        }
        *counts.entry(dir).or_insert(0) += n;
    }
    let mut dirs: Vec<Dir> = counts
        .into_iter()
        .map(|(path, count)| Dir { path, count })
        .collect();
    // 名前の順（大文字・小文字を区別しない）。親が子より先に来るよう、区切りごとに比べる
    dirs.sort_by(|a, b| {
        let key = |d: &Dir| {
            d.path
                .split('/')
                .map(|s| s.to_lowercase())
                .collect::<Vec<_>>()
        };
        key(a).cmp(&key(b))
    });
    Ok(dirs)
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

pub fn insert_root(conn: &Connection, path: &str, recursive: bool) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO roots (path, recursive, scanned, added_at) VALUES (?1, ?2, 0, ?3)",
        params![path, recursive, now_ms()],
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
    /// メモ（無ければ空）。
    pub note: String,
    /// アプリが変化に気付いた日時（ミリ秒）。気付いたことが無ければ None。
    pub changed_at: Option<i64>,
    /// 気付いた変化：`new`（新しく増えた）か `updated`（中身が変わった）。
    pub change: Option<String>,
}

/// 一覧に出すもの。サイドバーの項目に対応する。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Place {
    /// すべてのファイル（行方不明を除く）
    All,
    /// タグも仮想フォルダも無いもの
    Unsorted,
    Missing,
    /// 最近、中身が変わったものと新しく増えたもの（`RECENT_DAYS` 日のうちに気付いたもの。行方不明を除く）
    Recent,
    /// 登録フォルダ（`dir` が空）か、その中のフォルダに直接入っているもの
    /// （下のフォルダの中身は含めない。Finder と同じ）
    Root {
        id: i64,
        #[serde(default)]
        dir: String,
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
    use rusqlite::types::Value;
    let (filter, args): (&str, Vec<Value>) = match place {
        Place::All => ("f.missing = 0", vec![]),
        Place::Unsorted => (
            "f.missing = 0
             AND NOT EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id)
             AND NOT EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id)",
            vec![],
        ),
        Place::Missing => ("f.missing = 1", vec![]),
        Place::Recent => (
            "f.missing = 0 AND f.changed_at >= ?1",
            vec![recent_since().into()],
        ),
        Place::Root { id, dir } => (
            "f.missing = 0 AND f.root_id = ?1 AND f.dir = ?2",
            vec![id.into(), dir.into()],
        ),
        // タグ・仮想フォルダでは、行方不明のものも出す（付けた情報は残っているので）
        Place::Tag { id } => (
            "EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id AND t.tag_id = ?1)",
            vec![id.into()],
        ),
        Place::Folder { id } => (
            "EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id AND v.vfolder_id = ?1)",
            vec![id.into()],
        ),
    };
    let sql = format!(
        "SELECT f.id, f.root_id, f.path, f.name, f.ext, f.size, f.mtime, f.missing,
            (SELECT GROUP_CONCAT(tag_id) FROM file_tags WHERE file_id = f.id),
            (SELECT GROUP_CONCAT(vfolder_id) FROM vfolder_files WHERE file_id = f.id),
            f.note, f.changed_at, f.change_kind
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
            note: r.get(10)?,
            changed_at: r.get(11)?,
            change: r.get(12)?,
        })
    };
    let rows = st
        .query_map(rusqlite::params_from_iter(args), map)?
        .collect();
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

/// プレビューに要るもの：パス・拡張子・大きさ・更新日時。行方不明なら `None`。
pub fn preview_info(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<Option<(String, String, i64, i64)>> {
    conn.query_row(
        "SELECT path, ext, size, mtime FROM files WHERE id = ?1 AND missing = 0",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()
}

/// タグ・仮想フォルダ・メモが付いたファイルの数（登録を外す前の確認用）。
pub fn organized_count(conn: &Connection, root_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM files f WHERE f.root_id = ?1 AND (f.note != ''
            OR EXISTS (SELECT 1 FROM file_tags t WHERE t.file_id = f.id)
            OR EXISTS (SELECT 1 FROM vfolder_files v WHERE v.file_id = f.id))",
        [root_id],
        |r| r.get(0),
    )
}

/// メモを書く（空なら消す）。アプリのデータに書くだけで、元のファイルには触らない。
pub fn set_note(conn: &Connection, id: i64, note: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET note = ?2 WHERE id = ?1",
        params![id, note],
    )?;
    Ok(())
}

/// 行方不明のファイルの記録を外す（付けたタグ・仮想フォルダ・メモも消える）。
/// 行方不明でないものは外さない（次の読み込みでまた出てくるだけなので）。外した数を返す。
pub fn forget_missing(conn: &mut Connection, ids: &[i64]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    for id in ids {
        n += tx.execute("DELETE FROM files WHERE id = ?1 AND missing = 1", [id])?;
    }
    tx.commit()?;
    Ok(n)
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
/// メモは `to` に無ければ写す（両方にあれば `to` のものを残す）。
pub fn copy_organization(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET note = (SELECT note FROM files WHERE id = ?1) WHERE id = ?2 AND note = ''",
        params![from, to],
    )?;
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
        let id = insert_root(&conn, "/tmp/a", true).unwrap();
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
        let root = insert_root(&conn, "/r", true).unwrap();
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
    fn notes_count_as_organized_and_only_missing_rows_are_forgotten() {
        let (mut conn, ids) = with_files(2);
        let root: i64 = conn
            .query_row("SELECT id FROM roots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(organized_count(&conn, root).unwrap(), 0);
        set_note(&conn, ids[0], "メモ").unwrap();
        assert_eq!(organized_count(&conn, root).unwrap(), 1);
        assert_eq!(list_files(&conn, Place::All).unwrap()[0].note, "メモ");
        conn.execute("UPDATE files SET missing = 1 WHERE id = ?1", [ids[1]])
            .unwrap();
        assert_eq!(forget_missing(&mut conn, &ids).unwrap(), 1);
        assert_eq!(names(&conn, Place::All), ["0.pdf"]);
        assert!(names(&conn, Place::Missing).is_empty());
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

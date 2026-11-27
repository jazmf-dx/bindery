//! スペースで見るプレビュー（docs/CONCEPT.md「プレビュー」）。アプリの画面の中に出す。
//!
//! - PDF：元のファイルを、画面の PDF 表示でそのまま出す（`Preview::Pdf`）。中身が PDF のときだけ。
//!   asset プロトコルは中身で種類を決めるので、HTML が `.pdf` の名前で来ても、ページとして動かさない
//! - Word・Excel・PowerPoint など：作ったプレビューを `app_data_dir()/previews/` に置いて出す。
//!   macOS は Quick Look（`qlmanage -p -o`）の HTML か PDF、Windows は Office が作る PDF（win_office.rs）。
//!   Office が無いなど作れないときは `None`（画面は「プレビューできません」を出す）
//! - テキスト・Markdown・CSV・TSV：先頭を読んで、文字コードを見分けて渡す（`Preview::Text`）
//!
//! 元のファイルは読むだけ。アプリが書くのは `previews/` の中だけ。
//! Stockroom の files/preview.rs・win_office.rs から、この用途の部分だけを写した。

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Preview {
    Pdf {
        path: PathBuf,
    },
    /// `dir` の中の `file`。ページが使う画像などは `dir` の中にある。
    Html {
        dir: PathBuf,
        file: String,
    },
    Text {
        text: String,
        /// 先頭だけ読んだ（`TEXT_MAX` を超えた）。
        truncated: bool,
        /// `plain` / `markdown` / `csv` / `tsv`
        format: String,
    },
}

/// テキストのプレビューで読む大きさ（バイト）。
pub const TEXT_MAX: usize = 256 * 1024;

/// 1 つずつ作る：Office は 1 文書ずつ動かし、スペースを続けて押しても重ならないようにする。
static MAKING: Mutex<()> = Mutex::new(());

/// 中身が PDF か（先頭 1024 バイトのうちに `%PDF-` がある。PDF リーダーと同じ見方）。
pub fn is_pdf(path: &Path) -> bool {
    let mut head = Vec::with_capacity(1024);
    fs::File::open(path)
        .and_then(|f| f.take(1024).read_to_end(&mut head))
        .is_ok()
        && head.windows(5).any(|w| w == b"%PDF-")
}

/// 文字コードを見分けて読む：BOM（UTF-8 / UTF-16）、なければ UTF-8、なければ Shift_JIS、
/// それも合わなければ UTF-8 で壊れたところを置き換える。
pub fn decode(data: &[u8]) -> String {
    if let Some(rest) = data.strip_prefix(b"\xEF\xBB\xBF") {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if data.starts_with(b"\xFF\xFE") || data.starts_with(b"\xFE\xFF") {
        let enc = if data[0] == 0xFF {
            encoding_rs::UTF_16LE
        } else {
            encoding_rs::UTF_16BE
        };
        return enc.decode_without_bom_handling(&data[2..]).0.into_owned();
    }
    if let Ok(t) = std::str::from_utf8(data) {
        return t.to_string();
    }
    if let Some(t) =
        encoding_rs::SHIFT_JIS.decode_without_bom_handling_and_without_replacement(data)
    {
        return t.into_owned();
    }
    String::from_utf8_lossy(data).into_owned()
}

/// NUL が入っているものは、名前だけテキストのバイナリ（UTF-16 は BOM の後ろに NUL が入るので除く）。
fn is_binary(data: &[u8]) -> bool {
    !(data.starts_with(b"\xFF\xFE") || data.starts_with(b"\xFE\xFF"))
        && data[..data.len().min(8192)].contains(&0)
}

/// テキストの先頭を読む。バイナリなら `None`。
pub fn text(path: &Path, ext: &str) -> Option<Preview> {
    let mut data = Vec::new();
    // 1 バイト多く読んで、超えたかを知る
    fs::File::open(path)
        .ok()?
        .take(TEXT_MAX as u64 + 1)
        .read_to_end(&mut data)
        .ok()?;
    let truncated = data.len() > TEXT_MAX;
    data.truncate(TEXT_MAX);
    if is_binary(&data) {
        return None;
    }
    let mut text = decode(&data);
    if truncated {
        // 途中で切れた文字は、置き換えの印（U+FFFD）になっている。末尾のものを落とす
        while text.ends_with('\u{FFFD}') {
            text.pop();
        }
    }
    let format = match ext {
        "md" | "markdown" => "markdown",
        "csv" => "csv",
        "tsv" => "tsv",
        _ => "plain",
    };
    Some(Preview::Text {
        text,
        truncated,
        format: format.into(),
    })
}

/// 作ったプレビューの置き場所の名前。ファイルの大きさ・更新日時が変わったら別の名前になる（古いのは捨てる）。
fn stem(id: i64, size: i64, mtime: i64) -> String {
    format!("{id}-{size}-{mtime}")
}

/// 作ってあるプレビュー。
pub fn stored(previews: &Path, stem: &str) -> Option<Preview> {
    let pdf = previews.join(format!("{stem}.pdf"));
    if is_pdf(&pdf) {
        return Some(Preview::Pdf { path: pdf });
    }
    let dir = previews.join(format!("{stem}.qlpreview"));
    if dir.join("Preview.html").is_file() {
        return Some(Preview::Html {
            dir,
            file: "Preview.html".into(),
        });
    }
    let pdf = dir.join("Preview.pdf");
    is_pdf(&pdf).then_some(Preview::Pdf { path: pdf })
}

/// オフィス文書などのプレビュー。なければ今作る。この環境で作れなければ `None`。
pub fn document(
    previews: &Path,
    id: i64,
    size: i64,
    mtime: i64,
    path: &Path,
    ext: &str,
) -> Option<Preview> {
    let stem = stem(id, size, mtime);
    if let Some(p) = stored(previews, &stem) {
        return Some(p);
    }
    let _making = MAKING.lock().unwrap_or_else(|e| e.into_inner());
    // 待っているあいだに、ほかの呼び出しが作った
    if let Some(p) = stored(previews, &stem) {
        return Some(p);
    }
    fs::create_dir_all(previews).ok()?;
    remove_old(previews, id, &stem);
    make(previews, &stem, path, ext)
}

/// このファイルの古いプレビュー（大きさ・更新日時が違うもの）を消す。
fn remove_old(previews: &Path, id: i64, keep: &str) {
    let Ok(rd) = fs::read_dir(previews) else {
        return;
    };
    let prefix = format!("{id}-");
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && !name.starts_with(keep) {
            let p = e.path();
            let _ = if p.is_dir() {
                fs::remove_dir_all(p)
            } else {
                fs::remove_file(p)
            };
        }
    }
}

#[cfg(target_os = "macos")]
fn make(previews: &Path, stem: &str, path: &Path, _ext: &str) -> Option<Preview> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    // qlmanage は出力先に `<ファイル名>.qlpreview/` を書く。結果と同じ場所の一時フォルダに作って、名前を変えて置く
    let tmp = tempfile::Builder::new()
        .prefix(".ql-")
        .tempdir_in(previews)
        .ok()?;
    let mut child = Command::new("/usr/bin/qlmanage")
        .args(["-p", "-o"])
        .arg(tmp.path())
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // 壊れた文書で止まることがある。普通は 1 秒もかからない
    let start = Instant::now();
    let ok = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if start.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let made = tmp
        .path()
        .join(format!("{}.qlpreview", path.file_name()?.to_string_lossy()));
    if !ok || !(made.join("Preview.html").is_file() || made.join("Preview.pdf").is_file()) {
        return None;
    }
    let dest = previews.join(format!("{stem}.qlpreview"));
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&made, &dest).ok()?;
    stored(previews, stem)
}

#[cfg(windows)]
fn make(previews: &Path, stem: &str, path: &Path, ext: &str) -> Option<Preview> {
    let pdf = previews.join(format!("{stem}.pdf"));
    match crate::win_office::to_pdf(path, ext, &pdf) {
        Ok(()) => {}
        Err(crate::win_office::Error::Unavailable) => return None,
        Err(crate::win_office::Error::Failed(why)) => {
            log::warn!("{}: PDF にできませんでした: {why}", path.display());
            return None;
        }
    }
    stored(previews, stem)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn make(_previews: &Path, _stem: &str, _path: &Path, _ext: &str) -> Option<Preview> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_shift_jis_utf16_and_bom() {
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("品名,数量\r\n豚肉,5");
        assert_eq!(decode(&sjis), "品名,数量\r\n豚肉,5");
        assert_eq!(decode(b"\xEF\xBB\xBFabc"), "abc");
        assert_eq!(decode(b"\xFF\xFEa\0b\0"), "ab");
        assert_eq!(decode("日本語".as_bytes()), "日本語");
    }

    #[test]
    fn text_preview_is_cut_and_binary_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "# 見出し\n本文").unwrap();
        assert_eq!(
            text(&p, "md"),
            Some(Preview::Text {
                text: "# 見出し\n本文".into(),
                truncated: false,
                format: "markdown".into()
            })
        );
        let big = dir.path().join("big.txt");
        fs::write(&big, "あ".repeat(TEXT_MAX)).unwrap();
        match text(&big, "txt") {
            Some(Preview::Text { text, truncated, .. }) => {
                assert!(truncated);
                // 切れた文字の置き換えの印は残さない
                assert!(!text.ends_with('\u{FFFD}'));
            }
            other => panic!("unexpected {other:?}"),
        }
        let bin = dir.path().join("b.txt");
        fs::write(&bin, b"ab\0cd").unwrap();
        assert_eq!(text(&bin, "txt"), None);
    }

    #[test]
    fn only_a_real_pdf_counts() {
        let dir = tempfile::tempdir().unwrap();
        let ok = dir.path().join("a.pdf");
        fs::write(&ok, b"%PDF-1.7 ...").unwrap();
        assert!(is_pdf(&ok));
        // HTML が .pdf の名前で来ても、PDF として出さない
        let html = dir.path().join("b.pdf");
        fs::write(&html, b"<html><script>alert(1)</script>").unwrap();
        assert!(!is_pdf(&html));
    }

    #[test]
    fn finds_what_was_kept_and_drops_old_ones() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        assert_eq!(stored(p, "1-10-20"), None);
        fs::create_dir(p.join("1-10-20.qlpreview")).unwrap();
        fs::write(p.join("1-10-20.qlpreview/Preview.html"), "<p>x</p>").unwrap();
        assert_eq!(
            stored(p, "1-10-20"),
            Some(Preview::Html {
                dir: p.join("1-10-20.qlpreview"),
                file: "Preview.html".into()
            })
        );
        // 更新日時が変わったら、前のものは消える（別のファイルのものは残る）
        fs::create_dir(p.join("2-10-20.qlpreview")).unwrap();
        remove_old(p, 1, "1-10-99");
        assert!(!p.join("1-10-20.qlpreview").exists());
        assert!(p.join("2-10-20.qlpreview").exists());
    }

    /// Quick Look が作る Word 文書のプレビューは HTML のページ。
    #[cfg(target_os = "macos")]
    #[test]
    fn makes_a_quick_look_preview_of_a_document() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("doc.txt");
        fs::write(&src, "見出し\n\n本文").unwrap();
        let docx = dir.path().join("doc.docx");
        let ok = std::process::Command::new("/usr/bin/textutil")
            .args(["-convert", "docx", "-output"])
            .arg(&docx)
            .arg(&src)
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            eprintln!("skipping: textutil made no document");
            return;
        }
        let previews = dir.path().join("previews");
        match document(&previews, 7, 100, 200, &docx, "docx") {
            Some(Preview::Html { dir, file }) => {
                let html = fs::read_to_string(dir.join(file)).unwrap();
                assert!(html.contains("本文"));
            }
            None => eprintln!("skipping: Quick Look made no preview"),
            other => panic!("unexpected preview {other:?}"),
        }
        // 大きさ・更新日時が変わったら作り直し、前のものは捨てる
        let _ = document(&previews, 7, 100, 300, &docx, "docx");
        let left: Vec<_> = fs::read_dir(&previews).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.len() <= 1, "{left:?}");
    }
}

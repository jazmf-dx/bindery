//! Windows：Office 文書を、入っていれば Office 自身で PDF にする（Word・Excel・PowerPoint を COM で動かす）。
//! Windows には、これらを描くものが他に無い。Stockroom の files/win_office.rs から写した。
//!
//! PowerShell の短いスクリプトで Office を動かす（遅延バインドの COM は、あちらだと 1 行ずつで書ける）。
//! 1 文書ずつ（preview.rs）、Office が許す限り新しい非表示のインスタンスで：
//!
//! - 何も保存しない：読み取り専用・マクロ無効・警告なしで開く。パスワードが要る文書は、尋ねずに失敗にする
//! - Office を終わらせるのは、ほかに何も開いていないときだけ（PowerPoint は 1 つのインスタンスで、利用者のものかもしれない）
//! - Office が止まった文書は `TIMEOUT` で諦め、そのあいだに自動操作で起動した Office を終わらせる
//!
//! スクリプトは一時ファイルに書いて `-File` で実行する（パスは環境変数で渡すので、引用符の扱いは要らない）。

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(90);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug)]
pub enum Error {
    /// その種類の Office が入っていない、または PowerShell が COM を使えない（制限された言語モード）。やり直しても無駄。
    Unavailable,
    Failed(String),
}

/// この起動のあいだに使えないと分かったアプリ（スクリプトの `app` の名前）。
static UNAVAILABLE: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

fn app_of(ext: &str) -> Option<&'static str> {
    match ext {
        "doc" | "docx" | "rtf" => Some("word"),
        "xls" | "xlsx" | "xlsm" => Some("excel"),
        "ppt" | "pptx" => Some("powerpoint"),
        _ => None,
    }
}

fn may_convert(ext: &str) -> bool {
    app_of(ext).is_some_and(|app| !UNAVAILABLE.lock().unwrap().contains(&app))
}

// 終了コード：0 できた、3 アプリが入っていない、4 COM が使えない、2 失敗。
const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { exit 4 }
$kind = $env:BINDERY_APP; $src = $env:BINDERY_SRC; $out = $env:BINDERY_OUT
$progId = @{ word = 'Word.Application'; excel = 'Excel.Application'; powerpoint = 'PowerPoint.Application' }[$kind]
if (-not [type]::GetTypeFromProgID($progId)) { exit 3 }
$wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
$app = $null; $doc = $null; $code = 0
try {
  $app = New-Object -ComObject $progId
  $alerts = $app.DisplayAlerts; $security = $app.AutomationSecurity
  $app.AutomationSecurity = 3
  $m = [Type]::Missing
  switch ($kind) {
    'word' {
      $app.DisplayAlerts = 0
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument)
      $doc = $app.Documents.Open($src, $false, $true, $false, 'x')
      $doc.ExportAsFixedFormat($out, 17)
      $doc.Close(0)
    }
    'excel' {
      $app.DisplayAlerts = $false
      # Open(Filename, UpdateLinks, ReadOnly, Format, Password)
      $doc = $app.Workbooks.Open($src, 0, $true, $m, 'x')
      $doc.ExportAsFixedFormat(0, $out)
      $doc.Close($false)
    }
    'powerpoint' {
      $app.DisplayAlerts = 1
      # Open(FileName, ReadOnly, Untitled, WithWindow)
      $doc = $app.Presentations.Open($src, -1, 0, 0)
      $doc.SaveAs($out, 32)
      $doc.Close()
    }
  }
  $doc = $null
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $code = 2
  if ($doc) { try { $doc.Close(0) } catch {} }
} finally {
  if ($app) {
    try { $app.DisplayAlerts = $alerts; $app.AutomationSecurity = $security } catch {}
    $open = switch ($kind) { 'word' { $app.Documents.Count } 'excel' { $app.Workbooks.Count } 'powerpoint' { $app.Presentations.Count } }
    if ($open -eq 0 -and ($kind -ne 'powerpoint' -or -not $wasRunning)) { try { $app.Quit() } catch {} }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
}
exit $code
"#;

// 自動操作で起動した Office は、コマンドラインに /Automation -Embedding が付いている。
const CLEANUP: &str = r#"
$since = (Get-Date).AddSeconds(-[int]$env:BINDERY_SECONDS)
Get-CimInstance Win32_Process -Filter "Name='WINWORD.EXE' OR Name='EXCEL.EXE' OR Name='POWERPNT.EXE'" |
  Where-Object { $_.CommandLine -match '[/-](Automation|Embedding)' -and $_.CreationDate -ge $since } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;

/// スクリプトを一時ファイルに書いて、PowerShell で動かす準備をする。ファイルは戻り値を落とすと消える。
fn powershell(script: &str) -> std::io::Result<(tempfile::TempPath, Command)> {
    let mut f = tempfile::Builder::new().suffix(".ps1").tempfile()?;
    // 日本語のパスは環境変数で渡すが、念のため BOM 付き UTF-8 で書く（Windows PowerShell 5 が UTF-8 と読む印）
    std::io::Write::write_all(&mut f, b"\xEF\xBB\xBF")?;
    std::io::Write::write_all(&mut f, script.as_bytes())?;
    let path = f.into_temp_path();
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
    ])
    .arg(&path)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .creation_flags(CREATE_NO_WINDOW);
    Ok((path, cmd))
}

/// `src`（Office の種類）を PDF にして `out` に書く。
pub fn to_pdf(src: &Path, ext: &str, out: &Path) -> Result<(), Error> {
    let app = app_of(ext).ok_or(Error::Unavailable)?;
    if !may_convert(ext) {
        return Err(Error::Unavailable);
    }
    // Office は隣に書き、完全な PDF になってから名前を付ける
    let part = out.with_extension("part.pdf");
    let _ = std::fs::remove_file(&part);
    let start = Instant::now();
    let (_script, mut cmd) = powershell(SCRIPT).map_err(|e| Error::Failed(e.to_string()))?;
    let mut child = cmd
        .env("BINDERY_APP", app)
        .env("BINDERY_SRC", src)
        .env("BINDERY_OUT", &part)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::Failed(e.to_string()))?;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < TIMEOUT => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                end_hung_office(start.elapsed());
                let _ = std::fs::remove_file(&part);
                return Err(Error::Failed("Office が応答しませんでした".into()));
            }
            Err(e) => return Err(Error::Failed(e.to_string())),
        }
    };
    match status.code() {
        Some(0) if part.is_file() => {
            std::fs::rename(&part, out).map_err(|e| Error::Failed(e.to_string()))
        }
        Some(3) | Some(4) => {
            UNAVAILABLE.lock().unwrap().push(app);
            Err(Error::Unavailable)
        }
        _ => {
            let _ = std::fs::remove_file(&part);
            let mut msg = String::new();
            if let Some(mut e) = child.stderr.take() {
                let mut buf = Vec::new();
                let _ = std::io::Read::read_to_end(&mut e, &mut buf);
                msg = String::from_utf8_lossy(&buf).trim().to_string();
            }
            Err(Error::Failed(msg))
        }
    }
}

/// 自動操作で起動した Office のうち、`within` のあいだに起動したものを終わらせる。
fn end_hung_office(within: Duration) {
    if let Ok((_script, mut cmd)) = powershell(CLEANUP) {
        let _ = cmd
            .env("BINDERY_SECONDS", (within.as_secs() + 5).to_string())
            .stderr(Stdio::null())
            .status();
    }
}

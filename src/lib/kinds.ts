/** 種類（src-tauri/src/scan.rs `kind_of` と同じ分け方）。 */
export type Kind = "pdf" | "word" | "excel" | "powerpoint" | "text";

const BY_EXT: Record<string, Kind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  rtf: "word",
  odt: "word",
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  ods: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  txt: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  tsv: "text",
};

export const kindOf = (ext: string): Kind => BY_EXT[ext] ?? "text";

/** 扱う拡張子（ファイルを選ぶダイアログの絞り込み）。 */
export const EXTENSIONS = Object.keys(BY_EXT);

const LABEL: Record<Kind, string> = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  text: "テキスト",
};

/** 一覧の「種類」の欄。テキストは形式も添える（CSV など）。 */
export function kindLabel(ext: string): string {
  const k = kindOf(ext);
  return k === "text" ? `${LABEL.text}（${ext.toUpperCase()}）` : LABEL[k];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const DATE = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (ms: number) => (ms ? DATE.format(new Date(ms)) : "");

/** 登録フォルダから見た、ファイルのあるフォルダ（直下なら空）。区切りは OS のまま。 */
export function relativeDir(rootPath: string, filePath: string): string {
  if (!filePath.startsWith(rootPath)) return filePath;
  const rel = filePath.slice(rootPath.length).replace(/^[\\/]+/, "");
  const cut = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
  return cut < 0 ? "" : rel.slice(0, cut);
}

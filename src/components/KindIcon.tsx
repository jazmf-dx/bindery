/**
 * 種類のアイコン（色の付いた紙に白い印）。依存を増やさないよう、ここで描く。
 * 選んだ行（地が青）では、紙を白に、印を種類の色にして裏返す。色は index.css の `--color-kind-*`。
 */
import type { ReactNode } from "react";
import { iconKindOf, type IconKind } from "../lib/kinds";

const PAGE = "M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z";
const FOLD = "M9.5 1.5 13 5h-2.5a1 1 0 0 1-1-1z";

/** 紙の上の印（16×16 の中、x 4.5〜11.5・y 7〜13 に収める）。 */
const MARK: Record<IconKind, ReactNode> = {
  // Acrobat の輪を簡単にしたもの
  pdf: <path d="M5.2 12.6c1.6-.9 3.3-3.6 3.3-5.3 0-.8-.9-.8-.9.1 0 1.9 1.9 4.2 3.5 4.4.7.1.8-.7.1-.8-2-.3-4.6.4-6 1.6z" />,
  word: <path d="m5 7.6 1.25 4.8L8 8.9l1.75 3.5L11 7.6" />,
  excel: (
    <>
      <rect x="5" y="7.5" width="6" height="5" rx=".6" />
      <path d="M5 10h6M8 7.5v5" />
    </>
  ),
  powerpoint: (
    <>
      <circle cx="8" cy="10" r="2.6" />
      <path d="M8 10V7.4A2.6 2.6 0 0 1 10.6 10z" stroke="none" fill="currentColor" />
    </>
  ),
  // 区切られた値が並ぶ様子
  csv: <path d="M5 8h1.4m.9 0h1.4m.9 0H11M5 10h1.4m.9 0h1.4m.9 0H11M5 12h1.4m.9 0h1.4m.9 0H11" strokeLinecap="butt" />,
  // M と下向きの矢印（Markdown の印）
  markdown: <path d="M4.9 12.3V7.8l1.6 2 1.6-2v4.5m2.4-4.5v4.3m-1.3-1.3 1.3 1.3 1.3-1.3" />,
  text: <path d="M5 8h6M5 10h6M5 12h3.5" />,
};

/** `kind` を渡すと拡張子の代わりにそれで描く（条件のメニュー）。`size` はグリッドで大きく出すとき。 */
export function KindIcon({ ext = "", kind: given, on = false, size = 16 }: { ext?: string; kind?: IconKind; on?: boolean; size?: number }) {
  const kind = given ?? iconKindOf(ext);
  const color = `var(--color-kind-${kind})`;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
      <path d={PAGE} fill={on ? "#fff" : color} />
      <path d={FOLD} fill={on ? color : "#fff"} fillOpacity={on ? 0.45 : 0.5} />
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: on ? color : "#fff" }}>
        {MARK[kind]}
      </g>
    </svg>
  );
}

/** 一覧のフォルダの行のアイコン。 */
export function FolderIcon({ on = false, size = 16 }: { on?: boolean; size?: number }) {
  const color = "var(--color-kind-folder)";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
      <path d="M1.5 4a1 1 0 0 1 1-1h3.7l1.5 1.6h5.8a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill={on ? "#fff" : color} />
      <path d="M1.5 6.6h13V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill={on ? color : "#fff"} fillOpacity={on ? 0.3 : 0.22} />
    </svg>
  );
}

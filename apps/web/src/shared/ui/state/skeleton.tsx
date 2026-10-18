import type { CSSProperties, ReactNode } from "react";

/** 読み込み中の灰色の棒。動きは付けない（チラつきの元になるため）。 */
export function Skeleton({
  width = "100%",
  height = 14,
  className,
}: {
  width?: string;
  height?: number;
  className?: string;
}) {
  const style: CSSProperties = { width, height };
  return (
    <span
      className={className ? `skeleton ${className}` : "skeleton"}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * 骨組みの外枠。画面の読み上げには「読み込み中」とだけ伝え、骨組みの中身は読ませない。
 * `as`には本物の画面と同じ外側の要素とクラス名を渡し、読み込み後に形が動かないようにする。
 */
export function SkeletonFrame({
  className,
  as: Tag = "div",
  children,
}: {
  className?: string;
  as?: "div" | "main" | "section";
  children: ReactNode;
}) {
  return (
    <Tag className={className} role="status" aria-busy="true">
      <span className="sr-only">読み込み中</span>
      {children}
    </Tag>
  );
}

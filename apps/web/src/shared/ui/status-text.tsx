type StatusTextProps = {
  children: string;
  tone?: "normal" | "error";
};

export function StatusText({ children, tone = "normal" }: StatusTextProps) {
  return <p className={tone === "error" ? "error" : undefined}>{children}</p>;
}

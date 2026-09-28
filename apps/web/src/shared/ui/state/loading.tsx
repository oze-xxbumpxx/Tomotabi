export function Loading({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-label">{label}</span>
      <span
        className="loading-bar"
        style={{ width: "80%" }}
        aria-hidden="true"
      />
      <span
        className="loading-bar"
        style={{ width: "60%" }}
        aria-hidden="true"
      />
    </div>
  );
}

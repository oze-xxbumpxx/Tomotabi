import { CaretRight } from "@phosphor-icons/react";
import Link from "next/link";
import type {
  Participant,
  PreviewSummary,
} from "../api/settlement-api";
import { formatDateTime } from "@/shared/lib/local-date";
import { transferLabel } from "../model/breakdown";

function summaryText(
  preview: PreviewSummary,
  participants: Participant[],
): string {
  return transferLabel(preview.transfer, participants);
}

/**
 * 自分の未完了の確認（新しい順）。「確認内容を再開」は日時・方向・金額で
 * 本人が選んで開く（自動では選ばない）。記録できない状態の確認は
 * そのことを小さく添える。
 */
export function PendingPreviewList({
  tripId,
  previews,
  participants,
}: {
  tripId: string;
  previews: PreviewSummary[];
  participants: Participant[];
}) {
  return (
    <section className="settle-card">
      <h2 className="settle-card-title">未完了の確認</h2>
      <ul className="settle-rows">
        {previews.map((preview) => (
          <li key={preview.id}>
            <Link
              className="settle-row"
              href={`/trips/${tripId}/settlement/previews/${preview.id}`}
            >
              <span className="settle-row-main">
                <span className="settle-row-title">
                  {summaryText(preview, participants)}
                </span>
                <span className="settle-row-sub tabular-nums">
                  {`${formatDateTime(preview.createdAt)} に作成 · 対象 ${preview.targetCount} 件`}
                </span>
              </span>
              {preview.validation.status !== "ready" && (
                <span className="settle-row-note">記録できません</span>
              )}
              <CaretRight
                size={18}
                weight="bold"
                className="settle-row-caret"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

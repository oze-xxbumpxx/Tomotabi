import type { Trip } from "@tomotabi/contracts";

/**
 * 書き込みUseCaseの結果。receiptに保存したものと同じhttpStatus・bodyを持つ。
 * 同じキーの再送で元の結果を返すときもこの形（body.versionがETagの中身）。
 */
export type TripWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Trip;
}>;

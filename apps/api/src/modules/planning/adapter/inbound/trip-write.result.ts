import type { Trip } from "@tomotabi/contracts";

/**
 * 書き込み UseCase の結果。receipt に保存したものと同じ httpStatus・body を持つ。
 * 同じキーの再送で元の結果を返すときもこの形（body.version が ETag の中身）。
 */
export type TripWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Trip;
}>;

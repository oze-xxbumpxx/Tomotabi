import type { PipeTransform } from "@nestjs/common";
import type { z as zod } from "zod";
import { ApiError } from "./api-error";

export type ZodBodyPipeOptions = {
  /**
   * PATCH の部分更新（契約の `minProperties: 1`）用。パース後のオブジェクトが
   * 空なら 400 にする。
   */
  readonly nonEmptyObject?: boolean;
};

/**
 * contracts の OpenAPI から生成した Zod スキーマで body / query を検証する Pipe
 * （ADR-0004）。形式違反（型・未知の項目・パターン）は 400 INVALID_REQUEST、
 * 値の規則（コードポイントの文字数・実在日・期間）は Domain の値型が 422 にする。
 * コントローラでは `@Body(new ZodBodyPipe(CreateTripBody))` のように使う。
 */
export class ZodBodyPipe<S extends zod.ZodType> implements PipeTransform {
  constructor(
    private readonly schema: S,
    private readonly options: ZodBodyPipeOptions = {},
  ) {}

  transform(value: unknown): zod.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Request parameters are invalid",
      });
    }
    const data = result.data as zod.output<S>;
    if (
      this.options.nonEmptyObject === true &&
      typeof data === "object" &&
      data !== null &&
      Object.keys(data).length === 0
    ) {
      throw new ApiError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Request body must not be empty",
      });
    }
    return data;
  }
}

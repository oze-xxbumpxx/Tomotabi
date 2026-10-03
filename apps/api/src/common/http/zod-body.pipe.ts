import type { PipeTransform } from "@nestjs/common";
import type { z as zod } from "zod";
import { ApiError } from "./api-error";

export type ZodBodyPipeOptions = {
  /**
   * PATCHの部分更新（契約の`minProperties: 1`）用。パース後のオブジェクトが
   * 空なら400にする。
   */
  readonly nonEmptyObject?: boolean;
};

/**
 * contractsのOpenAPIから生成したZodスキーマでbody / queryを検証するPipe
 * （ADR-0004）。形式違反（型・未知の項目・パターン）は400 INVALID_REQUEST、
 * 値の規則（コードポイントの文字数・実在日・期間）はDomainの値型が422にする。
 * コントローラでは`@Body(new ZodBodyPipe(CreateTripBody))`のように使う。
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

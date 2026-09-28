import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { UserId } from "../../common/domain/user-id";
import type { IdempotencyKey } from "../../common/http/idempotency-key";
import type { CommandReceipt } from "../../common/idempotency/command-receipt";
import type { CommandReceiptStore } from "../../modules/planning/adapter/outbound/planning-work-context";
import { commandReceipts } from "./schema/infra";

/**
 * infra.command_receipts の読み書き。planning の UnitOfWork の文脈に束ねて使う
 * （同じトランザクションで書き込みと一緒に記録するため Pool ではなく tx の db を取る）。
 */
export class PgCommandReceipts implements CommandReceiptStore {
  constructor(private readonly db: NodePgDatabase) {}

  async find(
    actorId: UserId,
    operation: string,
    key: IdempotencyKey,
  ): Promise<CommandReceipt | null> {
    const rows = await this.db
      .select()
      .from(commandReceipts)
      .where(
        and(
          eq(commandReceipts.actorId, actorId),
          eq(commandReceipts.operation, operation),
          eq(commandReceipts.idempotencyKey, key),
        ),
      );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      actorId: UserId.parse(row.actorId),
      operation: row.operation,
      idempotencyKey: row.idempotencyKey as IdempotencyKey,
      tripId: row.tripId,
      requestHash: row.requestHash,
      resourceType: row.resourceType as CommandReceipt["resourceType"],
      resourceId: row.resourceId,
      httpStatus: row.httpStatus as CommandReceipt["httpStatus"],
      responseBody: row.responseBody,
    };
  }

  async insert(receipt: CommandReceipt): Promise<void> {
    await this.db.insert(commandReceipts).values({
      actorId: receipt.actorId,
      operation: receipt.operation,
      idempotencyKey: receipt.idempotencyKey,
      tripId: receipt.tripId,
      requestHash: receipt.requestHash,
      resourceType: receipt.resourceType,
      resourceId: receipt.resourceId,
      httpStatus: receipt.httpStatus,
      responseBody: receipt.responseBody,
    });
  }
}

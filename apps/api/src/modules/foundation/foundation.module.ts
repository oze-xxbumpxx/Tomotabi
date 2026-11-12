import { Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "../../infrastructure/database/pool.js";
import type { UnitOfWork } from "../../adapter/transaction/unit-of-work.js";
import {
  GET_PROBE_INPUT_PORT,
  type GetProbeInputPort,
} from "./adapter/inbound/get-probe.input-port.js";
import {
  GET_MIGRATION_STATUS_INPUT_PORT,
  type GetMigrationStatusInputPort,
} from "./adapter/inbound/get-migration-status.input-port.js";
import {
  INCREMENT_PROBE_INPUT_PORT,
  type IncrementProbeInputPort,
} from "./adapter/inbound/increment-probe.input-port.js";
import {
  FOUNDATION_UNIT_OF_WORK,
  type ProbeWorkContext,
} from "./adapter/outbound/probe-work-context.js";
import {
  MIGRATION_STATUS_READER,
  type MigrationStatusReader,
} from "./adapter/outbound/migration-status.port.js";
import {
  PROBE_REPOSITORY,
  type ProbeRepository,
} from "./adapter/outbound/probe.repository.js";
import {
  INCREMENT_PROBE_PORT,
  type IncrementProbePort,
} from "./adapter/service/increment-probe.port.js";
import { HealthController } from "./controller/health.controller.js";
import { ProbeController } from "./controller/probe.controller.js";
import { InMemoryMigrationStatus } from "./infrastructure/in-memory-migration-status.js";
import { InMemoryProbeRepository } from "./infrastructure/in-memory-probe.repository.js";
import { InMemoryProbeStore } from "./infrastructure/in-memory-probe.store.js";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work.js";
import { PgFoundationUnitOfWork } from "./infrastructure/pg-foundation-unit-of-work.js";
import { PgMigrationStatus } from "./infrastructure/pg-migration-status.js";
import { PgProbeRepository } from "./infrastructure/pg-probe.repository.js";
import { IncrementProbeService } from "./service/increment-probe.service.js";
import { GetMigrationStatusUseCase } from "./usecase/get-migration-status.usecase.js";
import { GetProbeUseCase } from "./usecase/get-probe.usecase.js";
import { IncrementProbeUseCase } from "./usecase/increment-probe.usecase.js";

const MEMORY_PROBE_STORE = Symbol("MEMORY_PROBE_STORE");

function useDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

@Module({
  controllers: [HealthController, ProbeController],
  providers: [
    {
      provide: MEMORY_PROBE_STORE,
      useFactory: (): InMemoryProbeStore => new InMemoryProbeStore(),
    },
    {
      provide: INCREMENT_PROBE_PORT,
      useFactory: (): IncrementProbePort => new IncrementProbeService(),
    },
    {
      provide: FOUNDATION_UNIT_OF_WORK,
      useFactory: (store: InMemoryProbeStore): UnitOfWork<ProbeWorkContext> => {
        if (useDatabase()) {
          return new PgFoundationUnitOfWork(getPool());
        }
        return new InMemoryUnitOfWork(store);
      },
      inject: [MEMORY_PROBE_STORE],
    },
    {
      provide: PROBE_REPOSITORY,
      useFactory: (store: InMemoryProbeStore): ProbeRepository => {
        if (useDatabase()) {
          return new PgProbeRepository(drizzle(getPool()));
        }
        return new InMemoryProbeRepository(store);
      },
      inject: [MEMORY_PROBE_STORE],
    },
    {
      provide: INCREMENT_PROBE_INPUT_PORT,
      useFactory: (
        unitOfWork: UnitOfWork<ProbeWorkContext>,
        incrementProbe: IncrementProbePort,
      ): IncrementProbeInputPort =>
        new IncrementProbeUseCase(unitOfWork, incrementProbe),
      inject: [FOUNDATION_UNIT_OF_WORK, INCREMENT_PROBE_PORT],
    },
    {
      provide: GET_PROBE_INPUT_PORT,
      useFactory: (probes: ProbeRepository): GetProbeInputPort =>
        new GetProbeUseCase(probes),
      inject: [PROBE_REPOSITORY],
    },
    {
      provide: MIGRATION_STATUS_READER,
      useFactory: (): MigrationStatusReader =>
        useDatabase()
          ? new PgMigrationStatus(getPool())
          : new InMemoryMigrationStatus(),
    },
    {
      provide: GET_MIGRATION_STATUS_INPUT_PORT,
      useFactory: (
        migrations: MigrationStatusReader,
      ): GetMigrationStatusInputPort =>
        new GetMigrationStatusUseCase(migrations),
      inject: [MIGRATION_STATUS_READER],
    },
  ],
})
export class FoundationModule {}

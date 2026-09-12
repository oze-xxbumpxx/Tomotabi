import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { ProbeWorkContext } from "../../src/modules/foundation/adapter/outbound/probe-work-context";
import { InMemoryProbeStore } from "../../src/modules/foundation/infrastructure/in-memory-probe.store";
import { InMemoryUnitOfWork } from "../../src/modules/foundation/infrastructure/in-memory-unit-of-work";
import { IncrementProbeService } from "../../src/modules/foundation/service/increment-probe.service";
import { IncrementProbeUseCase } from "../../src/modules/foundation/usecase/increment-probe.usecase";

describe("IncrementProbeUseCase", () => {
  it("loads, increments through the service port, and saves inside the unit of work", async () => {
    const store = new InMemoryProbeStore();
    const unitOfWork: UnitOfWork<ProbeWorkContext> = new InMemoryUnitOfWork(store);
    const useCase = new IncrementProbeUseCase(unitOfWork, new IncrementProbeService());

    await expect(useCase.execute()).resolves.toEqual({ count: 1 });
    expect(store.get().value).toBe(1);
  });
});

import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import {
  INCREMENT_PROBE_INPUT_PORT,
  type IncrementProbeInputPort,
} from "../../src/modules/foundation/adapter/inbound/increment-probe.input-port";
import { FoundationModule } from "../../src/modules/foundation/foundation.module";

describe("FoundationModule DI", () => {
  it("wires UseCase through adapter tokens rather than concrete constructors", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FoundationModule],
    }).compile();

    const increment = moduleRef.get<IncrementProbeInputPort>(
      INCREMENT_PROBE_INPUT_PORT,
    );

    await expect(increment.execute()).resolves.toEqual({ count: 1 });
  });
});

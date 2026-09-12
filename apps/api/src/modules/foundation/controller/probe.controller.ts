import { Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import type { ProbeView } from "@tomotabi/contracts";
import {
  GET_PROBE_INPUT_PORT,
  type GetProbeInputPort,
} from "../adapter/inbound/get-probe.input-port";
import {
  INCREMENT_PROBE_INPUT_PORT,
  type IncrementProbeInputPort,
} from "../adapter/inbound/increment-probe.input-port";

@Controller("foundation/probes")
export class ProbeController {
  constructor(
    @Inject(GET_PROBE_INPUT_PORT)
    private readonly getProbe: GetProbeInputPort,
    @Inject(INCREMENT_PROBE_INPUT_PORT)
    private readonly incrementProbe: IncrementProbeInputPort,
  ) {}

  @Get()
  get(): Promise<ProbeView> {
    return this.getProbe.execute();
  }

  @Post("increment")
  @HttpCode(200)
  increment(): Promise<ProbeView> {
    return this.incrementProbe.execute();
  }
}

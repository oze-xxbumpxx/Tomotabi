import { Controller, Get } from "@nestjs/common";
import type { HealthView } from "@tomotabi/contracts";

@Controller("health")
export class HealthController {
  @Get()
  get(): HealthView {
    return { status: "ok" };
  }
}

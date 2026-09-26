import { Controller, Get } from "@nestjs/common";
import type { HealthView } from "@tomotabi/contracts";
import { PublicRoute } from "../../../common/guard/public-route.decorator";

@Controller("health")
export class HealthController {
  @Get()
  @PublicRoute()
  get(): HealthView {
    return { status: "ok" };
  }
}

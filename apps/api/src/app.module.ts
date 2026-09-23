import { Module } from "@nestjs/common";
import { FoundationModule } from "./modules/foundation/foundation.module";

@Module({
  imports: [FoundationModule],
})
export class AppModule {}

import type { Me } from "@tomotabi/contracts";
import type { UserId } from "../../../common/domain/user-id";
import type { GetMeInputPort } from "../adapter/inbound/get-me.input-port";
import type { IdentityReader } from "../adapter/outbound/identity-reader";

export class GetMeUseCase implements GetMeInputPort {
  constructor(private readonly identities: IdentityReader) {}

  async execute(userId: UserId, sessionExpiresAt: Date): Promise<Me | null> {
    const displayName = await this.identities.findDisplayName(userId);
    if (displayName === null) {
      return null;
    }
    return {
      user: { id: userId, displayName },
      sessionExpiresAt: sessionExpiresAt.toISOString(),
    };
  }
}

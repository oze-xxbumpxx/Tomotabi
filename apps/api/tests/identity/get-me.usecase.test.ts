import { describe, expect, it } from "vitest";
import { UserId } from "../../src/common/domain/user-id";
import type { IdentityReader } from "../../src/modules/identity/adapter/outbound/identity-reader";
import { GetMeUseCase } from "../../src/modules/identity/usecase/get-me.usecase";

const USER_ID = UserId.parse("550e8400-e29b-41d4-a716-446655440000");

describe("GetMeUseCase", () => {
  // U-16: id・displayName・sessionExpiresAt だけを返す
  it("returns only user.id, user.displayName, and sessionExpiresAt", async () => {
    const identities: IdentityReader = {
      findDisplayName: async () => "ひなた",
    };
    const useCase = new GetMeUseCase(identities);
    const expiresAt = new Date("2026-10-02T12:34:56.000Z");

    await expect(useCase.execute(USER_ID, expiresAt)).resolves.toEqual({
      user: { id: USER_ID, displayName: "ひなた" },
      sessionExpiresAt: "2026-10-02T12:34:56.000Z",
    });
  });

  it("returns null when the identity is not found", async () => {
    const identities: IdentityReader = {
      findDisplayName: async () => null,
    };
    const useCase = new GetMeUseCase(identities);

    await expect(useCase.execute(USER_ID, new Date())).resolves.toBeNull();
  });
});

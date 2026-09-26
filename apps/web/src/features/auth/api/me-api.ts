import type { Me } from "@tomotabi/contracts";
import type { ResultAsync } from "neverthrow";
import type { ApiFailure } from "@/shared/api/api-failure";
import { callApi } from "@/shared/api/api-result";
import { getMe as requestGetMe } from "@/shared/api/generated/auth";
import { GetMeResponse } from "@/shared/api/generated/auth.zod";

export function getMe(): ResultAsync<Me, ApiFailure> {
  return callApi(requestGetMe(), GetMeResponse);
}

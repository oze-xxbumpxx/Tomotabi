import type { ProbeView } from "@tomotabi/contracts";
import type { ResultAsync } from "neverthrow";
import type { ApiFailure } from "@/shared/api/api-failure";
import { callApi } from "@/shared/api/api-result";
import {
  getProbe as requestGetProbe,
  incrementProbe as requestIncrementProbe,
} from "@/shared/api/generated/foundation";
import {
  GetProbeResponse,
  IncrementProbeResponse,
} from "@/shared/api/generated/foundation.zod";

export function getProbe(): ResultAsync<ProbeView, ApiFailure> {
  return callApi(requestGetProbe(), GetProbeResponse);
}

export function incrementProbe(): ResultAsync<ProbeView, ApiFailure> {
  return callApi(requestIncrementProbe(), IncrementProbeResponse);
}

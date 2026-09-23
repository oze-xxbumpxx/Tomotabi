import type { ProbeView } from "@tomotabi/contracts";
import { apiGet, apiPost } from "@/shared/api/http-client";

export function getProbe(): Promise<ProbeView> {
  return apiGet<ProbeView>("/api/foundation/probes");
}

export function incrementProbe(): Promise<ProbeView> {
  return apiPost<ProbeView>("/api/foundation/probes/increment");
}

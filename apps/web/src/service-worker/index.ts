import { registerServiceWorker } from "./register";
import type { ServiceWorkerScopeLike } from "./types";

registerServiceWorker(self as unknown as ServiceWorkerScopeLike);

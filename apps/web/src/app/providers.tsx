"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { createQueryClient } from "@/shared/api/query-client";
import { blockPinchZoom } from "@/shared/lib/block-pinch-zoom";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createQueryClient());
  useEffect(() => blockPinchZoom(document), []);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

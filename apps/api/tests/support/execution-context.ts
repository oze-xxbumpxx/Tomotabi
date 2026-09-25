import type { ExecutionContext } from "@nestjs/common";

export interface FakeHttpContextOptions {
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  handlerMetadata?: { key: string; value: unknown };
}

export function createHttpContext(
  options: FakeHttpContextOptions,
): ExecutionContext {
  const handler = function handler(): void {};
  if (options.handlerMetadata !== undefined) {
    Reflect.defineMetadata(
      options.handlerMetadata.key,
      options.handlerMetadata.value,
      handler,
    );
  }
  const request = options.request ?? {};
  const response = options.response ?? {};
  return {
    getHandler: () => handler,
    getClass: () => Object,
    getArgs: () => [request, response],
    getArgByIndex: () => request,
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    switchToRpc: () => ({
      getContext: () => undefined,
      getData: () => undefined,
    }),
    switchToWs: () => ({
      getClient: () => undefined,
      getData: () => undefined,
      getPattern: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

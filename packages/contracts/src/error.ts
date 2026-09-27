export type ApiErrorBody = {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
};

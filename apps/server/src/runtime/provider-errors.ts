export class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function providerFailure(error: unknown): string {
  return error instanceof ProviderError ? error.code : "provider-failed";
}

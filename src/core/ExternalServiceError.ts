/** Identifies a failure at an injected external-service boundary. */
export class ExternalServiceError extends Error {
  constructor(
    public readonly service: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

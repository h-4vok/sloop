/** Marks a resumed turn whose outcome cannot safely be retried. */
export class ResumeAmbiguousError extends Error {
  readonly phase = 'mid-turn' as const;

  constructor(message = 'harness resume failed after the turn may have started') {
    super(message);
    this.name = 'ResumeAmbiguousError';
  }
}

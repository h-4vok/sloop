/** Marks a session rejection known to happen before a turn starts. */
export class ResumeRejectedError extends Error {
  readonly phase = 'before-turn' as const;

  constructor(message = 'saved harness session was rejected before the turn started') {
    super(message);
    this.name = 'ResumeRejectedError';
  }
}

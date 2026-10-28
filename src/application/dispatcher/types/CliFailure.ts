/** Carries an expected dispatcher CLI exit code across the entrypoint boundary. */
export class CliFailure extends Error {
  constructor(
    public readonly exitCode: 2 | 3 | 5,
    message: string,
  ) {
    super(message);
  }
}

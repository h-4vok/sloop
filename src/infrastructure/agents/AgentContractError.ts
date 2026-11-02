/** Represents protocol and process-boundary failures in agent execution. */
export class AgentContractError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'AgentContractError';
    this.code = code;
  }
}

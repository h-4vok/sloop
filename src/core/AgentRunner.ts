/** Executes one configured agent specification. */
export interface AgentRunner<Spec> {
  run(spec: Spec): Promise<string>;
}

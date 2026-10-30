/** Storage port for the state owned by one dispatcher loop. */
export interface Workspace<State> {
  readonly root: string;

  load(): State;

  save(state: State): void;
}

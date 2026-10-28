/** Invocation and lifecycle callbacks for one agent or external process. */
export type Spec = {
  command: string;
  args: string[];
  timeoutMs: number;
  retries: number;
  sessions?: boolean;
  env?: NodeJS.ProcessEnv;
  input?: string;
  logInvocation?: boolean;
  onStart?: (pid: number) => void;
  onHeartbeat?: () => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

/** Supplies time and delay operations to the dispatcher loop. */
export interface Scheduler {
  now(): number;

  sleep(ms: number): Promise<void>;
}

/** Supplies process liveness checks used by lock recovery. */
export interface HealthGate {
  pid(): number;

  processAlive(pid: number): boolean;
}

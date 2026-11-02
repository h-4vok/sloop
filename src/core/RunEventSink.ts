/** Receives dispatcher lifecycle notifications. */
export interface RunEventSink {
  onReclaim(): void;
}

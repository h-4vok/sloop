// Defines the logging boundary used to keep application behavior independent of console I/O.
export type Logger = Readonly<{
  log: (message: string) => void;
  error: (message: string) => void;
}>;

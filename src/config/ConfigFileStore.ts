/** Describes the file operations required by configuration commands. */
export type ConfigFileStore = Readonly<{
  exists(file: string): boolean;
  read(file: string): string;
  writeAtomically(file: string, content: string): void;
  remove(file: string): void;
}>;

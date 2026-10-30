import { readFileSync, writeFileSync } from 'node:fs';
import { updateMetadata } from '../../application/release/ReleaseService.js';

/** Filesystem boundary used by the release publication scripts. */
export type ReleaseFiles = Readonly<{
  readFile: (file: string, encoding: BufferEncoding) => string;
  writeFile: (file: string, content: string) => void;
}>;

const productionReleaseFiles: ReleaseFiles = {
  readFile: readFileSync,

  writeFile: writeFileSync,
};

/** Updates repository release metadata through the supplied filesystem port. */
export function updateRepositoryMetadata(
  version: string,
  date: string,
  pr: number,
  files: ReleaseFiles = productionReleaseFiles,
): void {
  const result = updateMetadata(
    files.readFile('package.json', 'utf8'),
    files.readFile('CHANGELOG.md', 'utf8'),
    version,
    date,
    pr,
  );
  files.writeFile('package.json', result.packageText);
  files.writeFile('CHANGELOG.md', result.changelog);
}

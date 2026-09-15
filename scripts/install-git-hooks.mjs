import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
} catch {
  // npm install may run outside a Git checkout; hooks are optional there.
}

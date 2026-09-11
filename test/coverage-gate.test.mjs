import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test(
  'c8 rejects an uncovered branch at the enforced 80 percent threshold',
  { skip: Boolean(process.env.NODE_V8_COVERAGE) },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'sloop-coverage-gate-'));
    const fixture = join(root, 'fixture.js');
    writeFileSync(
      fixture,
      "if (process.argv[2] === 'covered') process.stdout.write('covered'); else process.stdout.write('uncovered');\n",
    );

    const { NODE_V8_COVERAGE: _coverageDirectory, ...isolatedEnv } = process.env;

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            require.resolve('c8/bin/c8.js'),
            '--all',
            '--include',
            'fixture.js',
            '--check-coverage',
            '--lines=100',
            '--statements=100',
            '--functions=100',
            '--branches=80',
            process.execPath,
            fixture,
            'covered',
          ],
          { cwd: root, encoding: 'utf8', stdio: 'pipe', env: isolatedEnv },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(String(error.stderr), /Coverage for branches/);
        return true;
      },
    );
  },
);

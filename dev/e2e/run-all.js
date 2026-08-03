// Runs every test-*.js suite in this directory sequentially; exits nonzero
// if any fail. Requires the app served at http://localhost:8080.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const suites = fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f)).sort();
let failed = 0;
for (const suite of suites) {
  process.stdout.write(`\n=== ${suite} ===\n`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
    process.stdout.write(`${suite}: PASS\n`);
  } catch {
    failed++;
    process.stdout.write(`${suite}: FAIL\n`);
  }
}
process.stdout.write(`\n${suites.length - failed}/${suites.length} suites passed\n`);
process.exit(failed ? 1 : 0);

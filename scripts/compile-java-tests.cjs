'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'java-tests');
fs.mkdirSync(output, {recursive: true});
const source = [
  path.join(root, 'android', 'src', 'com', 'plainapps', 'vault', 'LocalSync.java'),
  path.join(root, 'tests', 'LocalSyncHarness.java')
];
let result = spawnSync('javac', ['--release', '8', '-encoding', 'UTF-8', '-d', output, ...source], {cwd: root, stdio: 'inherit'});
if (result.error?.code === 'ENOENT' && process.env.PLAIN_VAULT_ECJ) {
  result = spawnSync('java', ['-jar', process.env.PLAIN_VAULT_ECJ, '-1.8', '-encoding', 'UTF-8', '-d', output, ...source], {cwd: root, stdio: 'inherit'});
}
if (result.error) {
  console.error('Java test compilation needs JDK 17+ (javac), or set PLAIN_VAULT_ECJ to an Eclipse ECJ jar with a Java runtime.');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status || 1);
console.log('Java local-sync test harness compiled.');

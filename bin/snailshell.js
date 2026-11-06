#!/usr/bin/env node
'use strict';
process.noDeprecation = true;
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error('Snailshell needs Node.js 18 or newer. You have ' + process.versions.node + '.\nGet the latest LTS from https://nodejs.org');
  process.exit(1);
}
require('../src/cli').main(process.argv.slice(2)).catch((err) => {
  process.stdout.write('\x1b[?25h');
  console.error('\n\x1b[31m✖ ' + (err && err.message ? err.message : err) + '\x1b[0m');
  if (process.env.SNAILSHELL_DEBUG && err && err.stack) console.error(err.stack);
  process.exit(1);
});

#!/usr/bin/env node
const { execSync } = require('child_process');
const { version }  = require('../package.json');

const platform = process.platform === 'darwin' ? 'macos'
               : process.platform === 'win32'  ? 'win'
               : process.platform;               // linux

const arch   = process.arch;                     // x64, arm64, …
const ext    = process.platform === 'win32' ? '.exe' : '';
const output = `bin/whatsbridge-v${version}-${platform}-${arch}${ext}`;

execSync(
  `npx @yao-pkg/pkg package.json --target node20 --output ${output}`,
  { stdio: 'inherit' },
);

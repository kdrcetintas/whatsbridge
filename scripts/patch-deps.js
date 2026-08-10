#!/usr/bin/env node
// Patches whatsapp-rust-bridge to add CommonJS exports so pkg can bundle it.
// Run automatically via postinstall.
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-rust-bridge', 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.log('[patch-deps] whatsapp-rust-bridge not found, skipping.');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

let changed = false;

if (!pkg.main) {
  pkg.main = './dist/index.js';
  changed = true;
}

if (pkg.exports?.['.'] && !pkg.exports['.'].require) {
  pkg.exports['.'].require = './dist/index.js';
  changed = true;
}

if (changed) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log('[patch-deps] Patched whatsapp-rust-bridge: added main + require export.');
} else {
  console.log('[patch-deps] whatsapp-rust-bridge already patched, skipping.');
}

#!/usr/bin/env node
// Rebuild Agent.exe using Node.js SEA (Single Executable Application)
// Requires: Node.js 20+, esbuild, postject (npm i -g postject)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const BUNDLED = path.join(DIR, '_agent-bundled.js');
const BLOB = path.join(DIR, '_sea-prep.blob');
const SEA_CFG = path.join(DIR, '_sea-config.json');
const EXE_OUT = path.join(DIR, 'Agent.exe');

console.log('\n  Building Agent.exe (Node.js SEA)\n');

// 1. Bundle with esbuild
console.log('  [1/4] Bundling with esbuild...');
execSync(`npx esbuild agent.js --bundle --platform=node --target=node20 --outfile="${BUNDLED}" --external:node:*`, { cwd: DIR, stdio: 'inherit' });

// 2. Generate SEA blob
console.log('\n  [2/4] Generating SEA blob...');
fs.writeFileSync(SEA_CFG, JSON.stringify({ main: '_agent-bundled.js', output: '_sea-prep.blob' }));
execSync('node --experimental-sea-config _sea-config.json', { cwd: DIR, stdio: 'inherit' });

// 3. Copy node.exe
console.log('\n  [3/4] Copying node.exe...');
fs.copyFileSync(process.execPath, EXE_OUT);
console.log(`  Copied: ${(fs.statSync(EXE_OUT).size / 1024 / 1024).toFixed(1)} MB`);

// 4. Inject blob
console.log('\n  [4/4] Injecting SEA blob...');
execSync(`postject "${EXE_OUT}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { cwd: DIR, stdio: 'inherit' });

// Cleanup temp files
console.log('\n  Cleaning up...');
for (const f of [BUNDLED, BLOB, SEA_CFG]) {
  try { fs.unlinkSync(f); } catch (_) {}
}

const size = (fs.statSync(EXE_OUT).size / 1024 / 1024).toFixed(1);
console.log(`\n  Done! Agent.exe: ${size} MB\n`);
console.log('  Deploy: Agent.exe + config.json next to it\n');

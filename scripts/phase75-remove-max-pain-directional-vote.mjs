import fs from 'node:fs';

const serverPath = 'server.ts';
let server = fs.readFileSync(serverPath, 'utf8');
const needle = 'function runRuleEngine(';
const declarations = server.split(needle).length - 1;
if (declarations !== 1) {
  console.error(`PHASE75_PATCH_FAIL: expected exactly one runRuleEngine declaration, found ${declarations}`);
  process.exit(1);
}
const start = server.indexOf(needle);
const braceStart = server.indexOf('{', start);
let depth = 0, mode = 'code', escaped = false, end = -1;
for (let i = braceStart; i < server.length; i++) {
  const ch = server[i], next = server[i + 1];
  if (mode === 'lineComment') { if (ch === '\n') mode = 'code'; continue; }
  if (mode === 'blockComment') { if (ch === '*' && next === '/') { mode = 'code'; i++; } continue; }
  if (mode === 'single' || mode === 'double' || mode === 'template') {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"') || (mode === 'template' && ch === '`')) mode = 'code';
    continue;
  }
  if (ch === '/' && next === '/') { mode = 'lineComment'; i++; continue; }
  if (ch === '/' && next === '*') { mode = 'blockComment'; i++; continue; }
  if (ch === "'") { mode = 'single'; continue; }
  if (ch === '"') { mode = 'double'; continue; }
  if (ch === '`') { mode = 'template'; continue; }
  if (ch === '{') depth++;
  if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) {
  console.error('PHASE75_PATCH_FAIL: could not isolate runRuleEngine');
  process.exit(1);
}

const voteRe = /if\s*\(\s*availableSignals\.has\(['"]max_pain['"]\)\s*&&\s*m\.maxPain\s*>\s*0\s*\)\s*\{\s*add\(['"]max_pain['"]\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\);\s*\}/;
let fn = server.slice(start, end);
const fnMatches = fn.match(new RegExp(voteRe.source, 'g')) ?? [];
if (fnMatches.length > 1) {
  console.error(`PHASE75_PATCH_FAIL: runRuleEngine contains ${fnMatches.length} exact Max Pain votes`);
  process.exit(1);
}
if (fnMatches.length === 1) {
  fn = fn.replace(voteRe, '');
  server = server.slice(0, start) + fn + server.slice(end);
  fs.writeFileSync(serverPath, server);
  console.log('PHASE75_PATCH: removed exactly one directional Max Pain vote from runRuleEngine only');
} else if (/add\(['"]max_pain['"]\s*,/i.test(fn)) {
  console.error('PHASE75_PATCH_FAIL: runRuleEngine still has Max Pain add() but safe pattern did not match');
  process.exit(1);
} else {
  console.log('PHASE75_PATCH: runRuleEngine already has no Max Pain scoring vote');
}

const docPath = 'docs/scoring-rules.md';
let doc = fs.readFileSync(docPath, 'utf8');
doc = doc.replace(
  '| 4 | `max_pain` | 0.5 | `+0.5` if spot < Max Pain; `−0.5` if spot > Max Pain; else `0` |',
  '| 4 | `max_pain` | 0 (context only) | Display/context evidence only. It does **not** contribute to `score`, `maxScore`, confidence, or verdict. |'
);
doc = doc.replace(
  '**Maximum theoretical score** (all 14 wired signals available, every one at its most extreme value, including the big-gap 3-point case): **17.0**. This is the sum of the 14 currently-wired weights (1+1+1+0.5+1+1+3+1.5+1+1+1.5+1+1.5+1 = 17), not a designed constant — it grew from 16.0 to 17.0 when `fib_pivot` (weight 1) was wired on 2026-08-09. `maxScore` in any real cycle will typically be lower, since not every signal is available every cycle.',
  '**Maximum theoretical scoring weight** with the documented scoring signals is **16.5** after removing Max Pain\'s former 0.5 directional vote. Max Pain may still be available as contextual evidence, but it contributes **0** to `score` and `maxScore`. `maxScore` in any real cycle will typically be lower when scoring signals are unavailable.'
);
if (!doc.includes('0 (context only)')) {
  console.error('PHASE75_PATCH_FAIL: scoring-rules Max Pain row was not updated');
  process.exit(1);
}
fs.writeFileSync(docPath, doc);

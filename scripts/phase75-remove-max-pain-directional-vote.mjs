import fs from 'node:fs';

const serverPath = 'server.ts';
let server = fs.readFileSync(serverPath, 'utf8');
const voteRe = /if\s*\(\s*availableSignals\.has\(['"]max_pain['"]\)\s*&&\s*m\.maxPain\s*>\s*0\s*\)\s*\{\s*add\(['"]max_pain['"]\s*,\s*m\.current\s*<\s*m\.maxPain\s*\?\s*0\.5\s*:\s*m\.current\s*>\s*m\.maxPain\s*\?\s*-0\.5\s*:\s*0\s*,\s*0\.5\s*\);\s*\}/;
const matches = server.match(new RegExp(voteRe.source, 'g')) ?? [];
if (matches.length > 1) {
  console.error(`PHASE75_PATCH_FAIL: expected at most one exact Max Pain scoring block, found ${matches.length}`);
  process.exit(1);
}
if (matches.length === 1) {
  server = server.replace(voteRe, '');
  fs.writeFileSync(serverPath, server);
  console.log('PHASE75_PATCH: removed exactly one Max Pain directional score/maxScore vote');
} else if (/add\(['"]max_pain['"]\s*,/i.test(server)) {
  console.error('PHASE75_PATCH_FAIL: Max Pain add() exists but exact safe pattern did not match; refusing broad edit');
  process.exit(1);
} else {
  console.log('PHASE75_PATCH: Max Pain scoring vote already absent');
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

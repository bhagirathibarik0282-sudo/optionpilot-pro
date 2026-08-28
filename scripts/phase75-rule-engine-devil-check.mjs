import fs from 'node:fs';

const source = fs.readFileSync('server.ts', 'utf8');
const needle = 'function runRuleEngine(';
const start = source.indexOf(needle);
if (start < 0) {
  console.error('PHASE75_FAIL: runRuleEngine function not found');
  process.exit(1);
}

// Extract the function body with a small lexer that ignores braces in strings/comments/template literals.
const braceStart = source.indexOf('{', start);
if (braceStart < 0) {
  console.error('PHASE75_FAIL: runRuleEngine opening brace not found');
  process.exit(1);
}

let depth = 0;
let mode = 'code';
let escaped = false;
let end = -1;
for (let i = braceStart; i < source.length; i++) {
  const ch = source[i];
  const next = source[i + 1];
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
  if (ch === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
if (end < 0) {
  console.error('PHASE75_FAIL: could not isolate runRuleEngine');
  process.exit(1);
}

const fn = source.slice(start, end);
const lower = fn.toLowerCase();
const maxPainMentions = [...lower.matchAll(/max[_ ]?pain|maxpain/g)].length;
const context = [];
for (const token of ['max_pain', 'maxpain', 'max pain']) {
  let p = lower.indexOf(token);
  while (p >= 0) {
    const s = Math.max(0, p - 180), e = Math.min(fn.length, p + token.length + 220);
    context.push(fn.slice(s, e).replace(/\s+/g, ' '));
    p = lower.indexOf(token, p + token.length);
  }
}

const directionalPatterns = [
  /score\s*\+=\s*[^;\n]*max[_ ]?pain/i,
  /maxscore\s*\+=\s*0\.5/i,
  /contributions?[^\n;]*max[_ ]?pain/i,
  /max[_ ]?pain[^\n;]{0,220}(\+\s*0\.5|-\s*0\.5)/i,
  /(\+\s*0\.5|-\s*0\.5)[^\n;]{0,220}max[_ ]?pain/i,
];
const directionalHits = directionalPatterns.filter((r) => r.test(fn)).map((r) => r.source);

console.log(JSON.stringify({
  phase: 'PHASE75_RULE_ENGINE_DEVIL_CHECK',
  functionFound: true,
  functionChars: fn.length,
  maxPainMentions,
  directionalPatternHits: directionalHits.length,
  maxPainContextPreview: context.slice(0, 8),
}, null, 2));

if (directionalHits.length > 0) {
  console.error('PHASE75_FAIL: Max Pain appears to have directional scoring influence inside runRuleEngine');
  process.exit(2);
}

console.log('PHASE75_PASS: no static directional Max Pain scoring pattern detected inside runRuleEngine');

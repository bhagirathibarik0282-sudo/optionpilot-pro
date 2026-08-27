import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('server.ts', 'utf8');
const lines = source.split(/\r?\n/);

const probes = [
  { name: 'SESSION_MAP', re: /const\s+sessions\s*=\s*new\s+Map/ },
  { name: 'SESSION_SET', re: /sessions\.set\s*\(/ },
  { name: 'SESSION_DELETE', re: /sessions\.delete\s*\(/ },
  { name: 'GET_SESSION', re: /function\s+getSession\s*\(/ },
  { name: 'KITE_CALLBACK', re: /kite.*callback|callback.*kite|request_token/i },
  { name: 'ACCESS_TOKEN_ASSIGN', re: /accessToken\s*[:=]/ },
  { name: 'TOKEN_RESPONSE', re: /access_token/ },
  { name: 'CREATE_CIPHER', re: /createCipheriv/ },
  { name: 'CREATE_DECIPHER', re: /createDecipheriv/ },
  { name: 'FILE_READ', re: /readFileSync/ },
  { name: 'FILE_WRITE', re: /writeFileSync/ },
  { name: 'DB_SESSION', re: /session.*db|db.*session/i },
  { name: 'BACKGROUND_REFRESH', re: /\[BACKGROUND\].*Market refresh|for \(const \[sessionId, session\] of sessions\)/ },
];

function sanitize(s) {
  return s
    .replace(/(api[_-]?key\s*[:=]\s*)['\"][^'\"]+['\"]/ig, '$1<REDACTED_LITERAL>')
    .replace(/(api[_-]?secret\s*[:=]\s*)['\"][^'\"]+['\"]/ig, '$1<REDACTED_LITERAL>')
    .replace(/(access[_-]?token\s*[:=]\s*)['\"][^'\"]+['\"]/ig, '$1<REDACTED_LITERAL>');
}

const findings = [];
for (let i = 0; i < lines.length; i++) {
  for (const probe of probes) {
    if (!probe.re.test(lines[i])) continue;
    const start = Math.max(0, i - 8);
    const end = Math.min(lines.length, i + 13);
    findings.push({
      probe: probe.name,
      line: i + 1,
      context: lines.slice(start, end).map((line, j) => `${start + j + 1}: ${sanitize(line)}`),
    });
  }
}

const summary = {
  version: 'PHASE61_SESSION_AUTHORITY_AUDIT_V1',
  sourceLines: lines.length,
  counts: Object.fromEntries(probes.map((p) => [p.name, findings.filter((f) => f.probe === p.name).length])),
  conclusions: {
    sessionMapPresent: findings.some((f) => f.probe === 'SESSION_MAP'),
    sessionPopulationSites: findings.filter((f) => f.probe === 'SESSION_SET').length,
    persistentSessionDbHints: findings.filter((f) => f.probe === 'DB_SESSION').length,
    encryptionPrimitivesPresent: findings.some((f) => f.probe === 'CREATE_CIPHER') && findings.some((f) => f.probe === 'CREATE_DECIPHER'),
  },
  findings,
};

writeFileSync('phase61-session-authority-audit.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

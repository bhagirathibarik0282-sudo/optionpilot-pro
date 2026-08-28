import fs from 'node:fs';

const path = 'server.ts';
const source = fs.readFileSync(path, 'utf8');
const oldBlock = `// Phase 62 read-only authority health. Never returns token or browser session id.\napp.get(\"/api/system/kite-session-authority\", async (c) => {\n  return c.json(await getKiteAuthorityPublicStatus());\n});`;
const newBlock = `// Phase 66: authenticated read-only authority health. Never returns token or browser session id.\napp.get(\"/api/system/kite-session-authority\", async (c) => {\n  const session = getSession(c);\n  if (!session) return c.json({ error: \"UNAUTHORIZED\" }, 401);\n  return c.json(await getKiteAuthorityPublicStatus());\n});`;

if (!source.includes(oldBlock)) {
  if (source.includes(newBlock)) {
    console.log('Phase 66 endpoint security patch already applied.');
    process.exit(0);
  }
  throw new Error('PHASE66_TARGET_BLOCK_NOT_FOUND');
}

fs.writeFileSync(path, source.replace(oldBlock, newBlock));
console.log('Phase 66 endpoint security patch applied.');
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const runner='scripts/pr799-real-archive-http-acceptance.ts';
const execute=(mode:string|null)=>{
 const env={...process.env};
 delete env.DATABASE_URL;
 delete env.PR799_EXACT_HTTP_SMOKE;
 if(mode)env.PR799_EXACT_HTTP_SMOKE=mode;
 return spawnSync(process.execPath,['--import','tsx',runner],{cwd:process.cwd(),env,encoding:'utf8',timeout:15000});
};
test('exact Recorder HTTP acceptance is opt-in and never starts with no configuration',()=>{
 const x=execute(null);
 assert.equal(x.status,1,'manual runner must fail closed');
 assert.equal(x.stdout,'','manual runner may not print archived market data');
 assert.match(x.stderr,/PR799_REAL_ARCHIVE_HTTP_HOLD/);
 assert.match(x.stderr,/Explicit one-shot flag required/);
});
test('explicit flag without Recorder database still fails without a listener',()=>{
 const x=execute('NIFTY_OCT19_1045_READ_ONLY');
 assert.equal(x.status,1);
 assert.equal(x.stdout,'');
 assert.match(x.stderr,/PR799_REAL_ARCHIVE_HTTP_HOLD/);
 assert.match(x.stderr,/Private Recorder connection required/);
});

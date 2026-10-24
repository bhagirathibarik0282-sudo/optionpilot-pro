import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { withStartupDatabaseClient } from '../db-startup-query.js';

function fake(fail:string|null=null){
 const calls:string[]=[],released:any[]=[];
 const client={query:async(sql:string)=>{calls.push(sql);if(sql===fail)throw Error('FAILED');return {rows:[{value:7}]};},release:(destroy:boolean)=>released.push(destroy)};
 return {calls,released,pool:{connect:async()=>client} as any};
}
test('startup budgets stay transaction-local and release a successful connection once',async()=>{
 const h=fake();const value=await withStartupDatabaseClient(h.pool,c=>c.query('SELECT 7'));
 assert.equal(value.rows[0].value,7);assert.deepEqual(h.calls,['BEGIN',"SET LOCAL statement_timeout = '10s'","SET LOCAL lock_timeout = '3s'",'SELECT 7','COMMIT']);assert.deepEqual(h.released,[false]);
});
test('startup failure rolls back and preserves the original error; a failed rollback discards the client',async()=>{
 const h=fake('SELECT broken');await assert.rejects(()=>withStartupDatabaseClient(h.pool,c=>c.query('SELECT broken')),/FAILED/);assert.equal(h.calls.at(-1),'ROLLBACK');assert.deepEqual(h.released,[false]);
 const bad=fake('ROLLBACK');await assert.rejects(()=>withStartupDatabaseClient(bad.pool,async()=>{throw Error('ORIGINAL');}),/ORIGINAL/);assert.deepEqual(bad.released,[true]);
});
test('blocked startup DDL is cancelled by PostgreSQL and existing data remains usable', {skip:!process.env.TEST_REPLAY_DATABASE_URL,timeout:15000},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_REPLAY_DATABASE_URL,max:3,connectionTimeoutMillis:3000}),table='startup_lock_test_'+process.pid;let lock:pg.PoolClient|undefined;
 try{
  await pool.query('CREATE TABLE '+table+' (value integer)');await pool.query('INSERT INTO '+table+' VALUES (7)');
  lock=await pool.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE '+table+' IN ACCESS SHARE MODE');
  const start=Date.now();await assert.rejects(()=>withStartupDatabaseClient(pool,c=>c.query('ALTER TABLE '+table+' ADD COLUMN extra integer')),(e:any)=>e.code==='55P03');assert(Date.now()-start<9000);
  await lock.query('ROLLBACK');lock.release();lock=undefined;
  assert.equal((await pool.query('SELECT value FROM '+table)).rows[0].value,7);assert.equal((await pool.query('SHOW lock_timeout')).rows[0].lock_timeout,'0','startup setting cannot leak to replay calls');
 }finally{if(lock){await lock.query('ROLLBACK');lock.release();}await pool.query('DROP TABLE IF EXISTS '+table);await pool.end();}
});

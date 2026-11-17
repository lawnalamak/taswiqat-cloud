import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../backend/db.mjs';
import { YOUTUBE_TABLE_NAMES } from '../backend/youtube-schema.mjs';
import { runYouTubeMaintenance } from '../backend/youtube.mjs';

// Opt in explicitly with the project's already-injected DATABASE_URL:
// TASWIQAT_YOUTUBE_READONLY_SQL_TEST=1 node --test tests/backend.youtube.readonly.test.mjs
// Never load/print environment files or credentials. The real DB receives plain
// EXPLAIN SELECT only, NOT EXPLAIN ANALYZE, maintenance, DML, locks or fixtures.
// Capturing against an EMPTY offline DB preserves the engine's exact SQL/args,
// including SELECT * shapes, without retrieving ciphertext or customer values.
const skip=process.env.TASWIQAT_YOUTUBE_READONLY_SQL_TEST!=='1'
  ? 'opt-in read-only MySQL EXPLAIN check'
  : !process.env.DATABASE_URL ? 'project DATABASE_URL is not injected' : false;
const offlineEnv={
  TASWIQAT_YOUTUBE_MODE:'testing',
  TASWIQAT_YOUTUBE_TEST_USER_IDS:'readonly-sql-fixture',
  TASWIQAT_YOUTUBE_CLIENT_ID:'OFFLINE_EXPLAIN_ONLY_CLIENT',
  TASWIQAT_YOUTUBE_CLIENT_SECRET:'OFFLINE_EXPLAIN_ONLY_SECRET',
  TASWIQAT_YOUTUBE_TOKEN_KEY:Buffer.alloc(32,1).toString('base64'),
};
async function captureQueries(batchSize) {
  const statements=[];
  const emptyDb={async query(sql,args=[]) {
    assert.ok(sql.startsWith('SELECT'),'offline capture must never mutate');
    if (sql.startsWith('SELECT MAX(version)')) return [{version:4}];
    if (sql.includes('information_schema.tables')) return YOUTUBE_TABLE_NAMES.map(table_name=>({table_name}));
    assert.match(sql,/^SELECT (?:id|\*) FROM taswiqat_youtube_(?:attempts|revocations|tokens) WHERE .+ ORDER BY \w+ LIMIT [1-9]\d*$/);
    statements.push({sql,args});return [];
  },async transaction() {assert.fail('empty offline capture must never start a transaction');}};
  const result=await runYouTubeMaintenance(emptyDb,offlineEnv,{batchSize,now:()=>Date.now(),fetcher:async()=>assert.fail('EXPLAIN fixture must never contact a provider')});
  assert.equal(result.disabled,false);assert.equal(result.failed,0);assert.equal(statements.length,5);
  assert.deepEqual(statements.map(s=>s.args.length),[1,3,2,4,2]);
  assert.deepEqual(statements.map(s=>Number(s.sql.match(/ LIMIT (\d+)$/)[1])),Array(5).fill(batchSize));
  return statements;
}
for (const limit of [1,5,100]) test(`read-only pool.execute EXPLAIN accepts all five actual maintenance SELECTs with LIMIT ${limit}`,{skip,timeout:60000},async t=>{
  const statements=await captureQueries(limit),db=createDatabase(process.env);
  try {
    for (const [index,{sql,args}] of statements.entries()) {
      assert.equal((sql.match(/\?/g)||[]).length,args.length);
      // EXPLAIN prepares the unchanged projection/predicates/limit; it does not
      // execute SELECT or fetch its row values. Only optimizer metadata returns.
      const plan=await db.query('EXPLAIN '+sql,args);
      assert.ok(Array.isArray(plan) && plan.length>0,`query ${index+1} must return an EXPLAIN plan`);
    }
    t.diagnostic(`5/5 SELECT shapes prepared successfully via EXPLAIN; LIMIT ${limit}; no row values retrieved`);
  } finally {await db.close();}
});

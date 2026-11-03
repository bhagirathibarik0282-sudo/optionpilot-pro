import {runH1ReplayHttp} from './h1-replay-http.js';
import {dbQuerySafe} from './db.js';
import {createLadderRecorderSource} from './telegram-ladder-source.js';
/** Read-only binding to existing archive interfaces and shared database pool. Inert until called. */
export const readExistingLadderFrames=createLadderRecorderSource({
  replay:runH1ReplayHttp,
  async participation({date,from,to}) {
    const result=await dbQuerySafe<{payload:unknown}>(`SELECT payload FROM app_state_log
      WHERE kind='DASHBOARD_PARTICIPATION_MINUTE_V1' AND payload->>'tradeDate'=$1
      AND (payload->>'minuteBucket')::timestamptz >= $2::timestamptz
      AND (payload->>'minuteBucket')::timestamptz <= $3::timestamptz ORDER BY payload->>'minuteBucket' LIMIT 16`,[date,from,to]);
    if(!result)throw Error('PARTICIPATION_READ_FAILED');
    if(result.rows.length>15)throw Error('PARTICIPATION_DUPLICATE_OR_OVERFLOW');
    return result.rows.map(r=>r.payload);
  },
});

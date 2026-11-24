import {readFileSync,writeFileSync} from 'node:fs';
import {adaptEventBuyerEod} from '../event-buyer-eod-adapter.js';
import {auditEventBuyerSession} from '../event-buyer-batch-audit.js';
const [file,symbol,output,replayFile,near,far]=process.argv.slice(2);
if(!file||!symbol||!output)throw Error('Usage: node --import tsx scripts/event-buyer-eod-audit.ts archive.json NIFTY new-report.json [replay.json near-expiry far-expiry]');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const a=adaptEventBuyerEod(read(file),symbol,replayFile?read(replayFile):undefined);
const report={date:a.memory.tradeDate,symbol,coverage:a.coverage,blockers:a.blockers,backtest:near&&far?auditEventBuyerSession({date:a.memory.tradeDate,symbol,expiries:[near,far],recorded:a.recorded,memory:a.memory}):null};
writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({date:report.date,symbol,coverage:report.coverage,blockers:report.blockers,backtestStatus:report.backtest?.status??'NOT_RUN'},null,2));

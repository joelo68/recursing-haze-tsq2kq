// Offline only. No Firebase import, network, queries, credentials or writes.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {auditOfflineSnapshot}=require('../functions/activitySalesL3B2B4ReadinessAudit.js');
const input=process.argv[2];
if(!input){console.error('Usage: node scripts/activitySalesL3B2B4ReadinessAudit.mjs <OFFLINE_SNAPSHOT.json>');process.exit(2);}
try{
  const stat=fs.statSync(input);
  if(!stat.isFile()||stat.size>512*1024)throw new Error('INVALID_INPUT_SIZE');
  const data=JSON.parse(fs.readFileSync(input,'utf8'));
  const report=auditOfflineSnapshot(data);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // Deliberately NEVER report a "ready" or return 0 as permission to deploy.
  process.exitCode=3;
}catch(e){console.error('L3B2B4_OFFLINE_AUDIT_REJECTED:',String(e.code||e.message));process.exitCode=2;}

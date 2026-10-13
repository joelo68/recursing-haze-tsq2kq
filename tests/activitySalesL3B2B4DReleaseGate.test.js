import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const {buildReleaseGate,REQUIRED_POLICY_CODES}=require('../functions/activitySalesL3B2B4DReleaseGate.js');
test('release inventory always denies authorization, posting and deployment',()=>{
 const report=buildReleaseGate();
 assert.equal(report.status,'HOLD_NOT_RELEASE_AUTHORIZED');
 assert.equal(report.productionReadsPerformed,0);
 assert.equal(report.finance.approvedCount,0);
 assert.equal(report.finance.requiredPolicyCodes.length,9);
 assert.equal(new Set(REQUIRED_POLICY_CODES).size,9);
 for(const [key,value] of Object.entries(report.permissions)) assert.equal(value,false,key);
 assert.ok(report.authorization.blockers.length>=7);
 assert.ok(report.otherBlockers.length>=6);
});
test('reports are independently allocated and cannot unlock by mutation',()=>{
 const a=buildReleaseGate();a.permissions.canPost=true;a.finance.requiredPolicyCodes.length=0;
 const b=buildReleaseGate();assert.equal(b.permissions.canPost,false);assert.equal(b.finance.requiredPolicyCodes.length,9);
});
test('CLI returns explicit HOLD exit 3 and disallows arguments',()=>{
 const cli=path.resolve(__dirname,'../scripts/activitySalesL3B2B4DReleaseGate.mjs');
 const r=spawnSync(process.execPath,[cli],{encoding:'utf8'});
 assert.equal(r.status,3);assert.equal(JSON.parse(r.stdout).permissions.canDeploy,false);
 const bad=spawnSync(process.execPath,[cli,'--approved=true'],{encoding:'utf8'});
 assert.equal(bad.status,2);assert.match(bad.stderr,/NO_ARGUMENTS_ALLOWED/);
});

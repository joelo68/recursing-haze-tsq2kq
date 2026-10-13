// L3B2B4B. Manual, bounded, read-only. --plan never imports Firebase.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {checkScope,collectScopedEvidence}=require('../functions/activitySalesL3B2B4ControlledRead.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function exit(code){console.error('L3B2B4B_STOP:',code);process.exitCode=2;}
function args(argv){
 const a={};for(const part of argv){const i=part.indexOf('=');if(i<3||!part.startsWith('--'))throw Error('ARGUMENT_INVALID');const key=part.slice(2,i);if(!['mode','scope','project-id','ack'].includes(key)||Object.hasOwn(a,key))throw Error('ARGUMENT_INVALID');a[key]=part.slice(i+1);}
 return a;
}
function scopeFile(p,live){
 if(!p)throw Error('SCOPE_FILE_REQUIRED');const full=path.resolve(p),lstat=fs.lstatSync(full);
 if(lstat.isSymbolicLink()||!lstat.isFile()||lstat.size>32768)throw Error('SCOPE_FILE_UNSAFE');
 if(live){if((lstat.mode&0o077)!==0)throw Error('SCOPE_FILE_PERMISSIONS');
  if(full===root||full.startsWith(root+path.sep))throw Error('SCOPE_MUST_BE_OUTSIDE_REPO');
 }
 return JSON.parse(fs.readFileSync(full,'utf8'));
}
async function main(){
 const a=args(process.argv.slice(2));if(!['plan','read'].includes(a.mode))throw Error('MODE_REQUIRED');
 const scope=checkScope(scopeFile(a.scope,a.mode==='read'));
 if(a.mode==='read'&&scope.selected.some(x=>x.accountId.startsWith('SYNTHETIC_')))throw Error('SYNTHETIC_SCOPE_NOT_ALLOWED');
 const preview={mode:'PLAN_ONLY_NO_DATABASE_ACCESS',status:'HOLD_NO_POSTING',brands:scope.byBrand,
  selectedProfiles:scope.profileCount,readCeiling:scope.estimatedReadCeiling,readsPerformed:0,
  permissions:{canDeploy:false,canGrantAuthority:false,canSettle:false,canPost:false}};
 if(a.mode==='plan'){console.log(JSON.stringify(preview,null,2));process.exitCode=3;return;}
 const project=a['project-id'];
 if(!project||! /^[a-z][a-z0-9-]{4,49}$/.test(project))throw Error('PROJECT_ID_INVALID');
 if(a.ack!=='I_AUTHORIZE_BOUNDED_READ_ONLY')throw Error('EXPLICIT_OPERATOR_ACK_REQUIRED');
 if(process.env.DRCYJ_AUDIT_PROJECT_ID!==project)throw Error('PROJECT_ENV_MISMATCH');
 if(process.env.FIRESTORE_EMULATOR_HOST)throw Error('EMULATOR_ENV_PRESENT');
 if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==project)throw Error('GCLOUD_PROJECT_MISMATCH');
 if(process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT!==project)throw Error('GOOGLE_PROJECT_MISMATCH');
 if(process.env.FIREBASE_CONFIG){let conf;try{conf=JSON.parse(process.env.FIREBASE_CONFIG);}catch{throw Error('FIREBASE_CONFIG_INVALID');}if(conf.projectId&&conf.projectId!==project)throw Error('FIREBASE_PROJECT_MISMATCH');}
 // Only after all fail-closed checks: initialize official SDK with operator-owned ADC.
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:project},'l3b2b4b-controlled-audit');
 try{
   const report=await collectScopedEvidence(app.firestore(),{schemaVersion:'activity-sales-l3b2b4b-controlled-scope-v1',profiles:scope.selected.map(({brandId,roleId,accountId})=>({brandId,roleId,accountId}))});
   console.log(JSON.stringify(report,null,2));process.exitCode=3;
 }finally{await app.delete();}
}
main().catch(e=>exit(String(e?.code||e?.message||'L3B2B4B_READ_FAILED').startsWith('L3B2B4B_')?String(e.code||e.message):'L3B2B4B_READ_FAILED'));

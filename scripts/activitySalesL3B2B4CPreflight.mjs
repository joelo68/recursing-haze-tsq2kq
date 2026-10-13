// Review-only offline CLI. Does not import Firebase, cloud SDKs or any network client.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {reviewPreflight}=require('../functions/activitySalesL3B2B4CPreflight.js');
const permitted=new Set(['scope','request']);
function stop(){console.error('L3B2B4C_PREFLIGHT_REJECTED');process.exitCode=2;}
function readJson(file){
 if(!file||typeof file!=='string')throw Error('BAD_PATH');
 const absolute=path.resolve(file),stat=fs.lstatSync(absolute);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>32768)throw Error('BAD_FILE');
 return JSON.parse(fs.readFileSync(absolute,'utf8'));
}
try{
 const a={};for(const part of process.argv.slice(2)){
  const pos=part.indexOf('=');if(pos<3||!part.startsWith('--'))throw Error('BAD_ARG');
  const key=part.slice(2,pos);if(!permitted.has(key)||Object.hasOwn(a,key))throw Error('BAD_ARG');
  a[key]=part.slice(pos+1);
 }
 if(Object.keys(a).length!==2)throw Error('MISSING_ARG');
 const result=reviewPreflight(readJson(a.scope),readJson(a.request));
 console.log(JSON.stringify(result,null,2));
 // Exit 3 is an intentional HOLD, NEVER successful read authorization.
 process.exitCode=3;
}catch{stop();}

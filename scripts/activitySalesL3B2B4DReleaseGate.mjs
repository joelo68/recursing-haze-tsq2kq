// Offline inventory only. No file inputs, Firebase SDK or network calls.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildReleaseGate}=require('../functions/activitySalesL3B2B4DReleaseGate.js');
if(process.argv.length!==2){console.error('L3B2B4D_NO_ARGUMENTS_ALLOWED');process.exitCode=2;}
else {console.log(JSON.stringify(buildReleaseGate(),null,2));process.exitCode=3;}

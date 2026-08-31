import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const ENDPOINT = 'https://us-central1-cyjsituation-analysis.cloudfunctions.net/auditExplicitZeroTargets';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDqeHT2J9Z69k88-clPwKyuywg1TSpojYM',
  authDomain: 'cyjsituation-analysis.firebaseapp.com',
  projectId: 'cyjsituation-analysis',
  storageBucket: 'cyjsituation-analysis.firebasestorage.app',
  messagingSenderId: '139860745126',
  appId: '1:139860745126:web:4539176a4cf73ae4480d67',
};

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[name] = true;
    else { args[name] = next; i += 1; }
  }
  return args;
}

function prompt(question, { hidden = false } = {}) {
  if (!hidden) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
  }

  process.stdout.write(question);
  let muted = true;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => rl.question('', (answer) => {
    muted = false;
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  }));
}

function stamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

const args = parseArgs(process.argv.slice(2));
const brandId = String(args.brand || 'yibo').trim().toLowerCase();
if (brandId !== 'yibo') {
  console.error('ABORT: 5E-0.5 placeholder audit is intentionally scoped to --brand yibo only');
  process.exit(2);
}

const accountId = String(args['account-id'] || await prompt('最高管理者帳號識別： ')).trim();
const deviceId = String(args['device-id'] || await prompt('Trusted Device ID： ')).trim();
const userName = String(args['user-name'] || accountId || '最高管理者').trim();
const credentialPassword = String(await prompt('目前最高管理者登入密碼（輸入不回顯）： ', { hidden: true }));

if (!accountId || !deviceId || !credentialPassword) {
  console.error('ABORT: accountId / deviceId / password 不可為空');
  process.exit(2);
}

const app = initializeApp(FIREBASE_CONFIG, `placeholder-zero-audit-${Date.now()}`);
const auth = getAuth(app);
await signInAnonymously(auth);
const idToken = await auth.currentUser?.getIdToken();
if (!idToken) throw new Error('Firebase anonymous auth failed');

process.stdout.write('Auditing yibo placeholder-zero lifecycle state ... ');
const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  },
  body: JSON.stringify({
    brandId: 'yibo',
    actor: {
      roleId: 'director',
      accountId,
      userName,
      deviceId,
      credentialPassword,
    },
  }),
});

const result = await response.json().catch(() => ({}));
if (!response.ok || result?.ok === false) {
  console.log('FAILED');
  throw new Error(result?.message || `HTTP ${response.status}`);
}
if (result?.auditOnly !== true || Number(result?.readEstimate?.firestoreWrites || 0) !== 0) {
  throw new Error('Backend response is not read-only');
}
if (String(result?.inventoryVersion || '') !== 'zero-target-production-inventory-v2') {
  throw new Error(`Expected inventory v2, received ${result?.inventoryVersion || 'unknown'}`);
}

console.log(`OK | docs=${result.summary?.uniqueTargetDocs || 0} | months=${result.summary?.affectedMonths?.length || 0} | lifecycle=${result.lifecycle?.datasetStatus || 'unknown'} | estReads=${result.readEstimate?.estimatedFirestoreReads || 0}`);

const outDir = path.join(os.homedir(), 'Downloads', 'work');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `DRCYJ_BATCH5E05_PLACEHOLDER_ZERO_LIFECYCLE_AUDIT_${stamp()}.json`);
const payload = {
  auditOnly: true,
  generatedAtText: new Date().toISOString(),
  endpoint: ENDPOINT,
  brandId: 'yibo',
  result,
};
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Saved: ${outPath}`);
console.log('Firestore writes: 0 (endpoint contract)');

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldForceFirestoreLongPolling } from "../src/utils/firestoreTransport.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const firebaseSource = fs.readFileSync(path.join(root, "src/config/firebase.js"), "utf8");

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

test("production transport forces long-polling for iPhone/iPad WebKit only", () => {
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: IOS_SAFARI, maxTouchPoints: 5 }),
    true
  );
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: IPAD_SAFARI, maxTouchPoints: 5 }),
    true
  );
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: IPADOS_DESKTOP, maxTouchPoints: 5 }),
    true
  );
});

test("desktop and non-Apple mobile browsers retain Firebase default transport", () => {
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: MAC_CHROME, maxTouchPoints: 0 }),
    false
  );
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: IPADOS_DESKTOP, maxTouchPoints: 0 }),
    false
  );
  assert.equal(
    shouldForceFirestoreLongPolling({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 }),
    false
  );
});

test("future non-WebKit iOS engine is not forced without evidence", () => {
  const hypotheticalNonWebKitIOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Gecko/20100101 Firefox/140.0";
  assert.equal(
    shouldForceFirestoreLongPolling({
      userAgent: hypotheticalNonWebKitIOS,
      maxTouchPoints: 5,
    }),
    false
  );
});

test("Firebase initialization scopes forced long-polling and keeps the default path for other clients", () => {
  assert.match(firebaseSource, /getFirestore,\s*initializeFirestore/);
  assert.match(firebaseSource, /shouldForceFirestoreLongPollingForCurrentBrowser/);
  assert.match(firebaseSource, /experimentalForceLongPolling:\s*true/);
  assert.match(firebaseSource, /\?\s*initializeFirestore\(app,/);
  assert.match(firebaseSource, /:\s*getFirestore\(app\)/);
  assert.doesNotMatch(firebaseSource, /experimentalLongPollingOptions\s*:/);
  assert.doesNotMatch(firebaseSource, /experimentalAutoDetectLongPolling\s*:/);
});

test("production transport patch does not alter Firebase project identity or Auth initialization", () => {
  assert.match(firebaseSource, /projectId:\s*"cyjsituation-analysis"/);
  assert.match(firebaseSource, /const auth = getAuth\(app\)/);
  assert.match(firebaseSource, /export \{ app, auth, db, appId \}/);
});

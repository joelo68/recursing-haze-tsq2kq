import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STORE_LOGIN_UNASSIGNED_REGION,
  buildStoreLoginRegionOptions,
  filterStoreAccountsForLoginRegion,
  getStoreAccountStoreCores,
  storeAccountBelongsToManager,
} from "../src/utils/loginDirectoryPresentation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const login = fs.readFileSync(path.join(root, "src/components/LoginView.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

const managers = {
  Jonas: ["安平", "永康"],
  Angel: ["古亭", "蘆洲"],
};

const storeAccounts = [
  { id: "s1", name: "Amy", stores: ["CYJ安平店"] },
  { id: "s2", name: "Betty", stores: ["永康"] },
  { id: "s3", name: "Coco", stores: ["古亭店"] },
  { id: "s4", name: "Dora", stores: ["不存在店"] },
  { id: "s5", name: "Eve", stores: ["蘆洲", "安平"] },
];

test("store login region presentation normalizes branded store names and supports multi-store accounts", () => {
  assert.deepEqual(getStoreAccountStoreCores(storeAccounts[0]), ["安平"]);
  assert.equal(storeAccountBelongsToManager(storeAccounts[0], "Jonas", managers), true);
  assert.equal(storeAccountBelongsToManager(storeAccounts[2], "Jonas", managers), false);
  assert.equal(storeAccountBelongsToManager(storeAccounts[4], "Jonas", managers), true);
  assert.equal(storeAccountBelongsToManager(storeAccounts[4], "Angel", managers), true);
});

test("store login region options follow supplied organization order and retain unassigned discoverability", () => {
  const options = buildStoreLoginRegionOptions({
    storeAccounts,
    managers,
    managerNames: ["Angel", "Jonas"],
  });

  assert.deepEqual(options, [
    { value: "Angel", label: "Angel" },
    { value: "Jonas", label: "Jonas" },
    { value: STORE_LOGIN_UNASSIGNED_REGION, label: "未分區／其他" },
  ]);
});

test("selected region filters only the account discovery list", () => {
  const jonas = filterStoreAccountsForLoginRegion({
    storeAccounts,
    managers,
    managerNames: ["Jonas", "Angel"],
    selectedRegion: "Jonas",
  });
  assert.deepEqual(jonas.map((row) => row.id), ["s1", "s2", "s5"]);

  const other = filterStoreAccountsForLoginRegion({
    storeAccounts,
    managers,
    managerNames: ["Jonas", "Angel"],
    selectedRegion: STORE_LOGIN_UNASSIGNED_REGION,
  });
  assert.deepEqual(other.map((row) => row.id), ["s4"]);
});

test("LoginView uses region then store-manager selectors and clears account when region changes", () => {
  assert.match(login, /const \[storeRegion, setStoreRegion\] = useState\(""\)/);
  assert.match(login, /buildStoreLoginRegionOptions\(/);
  assert.match(login, /filterStoreAccountsForLoginRegion\(/);
  assert.match(login, /<option value="">選擇區長<\/option>/);
  assert.match(login, /\{storeRegion \? "選擇店經理" : "請先選擇區長"\}/);
  assert.match(login, /setStoreRegion\(e\.target\.value\);\s*setSelectedUser\(""\);/s);
  assert.match(login, /disabled=\{!storeRegion\}/);
});

test("region selection is not promoted into authentication or device-security authority", () => {
  const storeBranchStart = login.indexOf('if (role === "store")');
  const storeBranchEnd = login.indexOf("} catch (error)", storeBranchStart);
  assert.ok(storeBranchStart >= 0 && storeBranchEnd > storeBranchStart);
  const storeBranch = login.slice(storeBranchStart, storeBranchEnd);

  assert.match(storeBranch, /const account = sortedStoreAccounts\.find/);
  assert.match(storeBranch, /finishBackendLogin\(\{ roleId: "store", accountId: account\.id/);
  assert.doesNotMatch(storeBranch, /accountId:\s*storeRegion|roleId:\s*storeRegion/);

  assert.match(app, /LOGIN_DIRECTORY_ENDPOINT/);
  assert.match(app, /DEVICE_ACCESS_ENDPOINT/);
  assert.match(app, /requestApplicationIdentityToken\s*:\s*true/);
  assert.match(rules, /drcyjIdentity/);
});

test("store-login filter adds no network, Firestore listener, query, polling, or credential handling", () => {
  const util = fs.readFileSync(path.join(root, "src/utils/loginDirectoryPresentation.js"), "utf8");
  assert.doesNotMatch(util, /firebase|firestore|fetch\(|onSnapshot|getDoc|getDocs|setDoc|addDoc|updateDoc|deleteDoc|collection\(|query\(|where\(|setInterval|password|credential/i);

  const selectorStart = login.indexOf("// 店經理登入的「區長」只作帳號搜尋/篩選");
  const selectorEnd = login.indexOf("const sortedManagerAccounts", selectorStart);
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart);
  const selectorBlock = login.slice(selectorStart, selectorEnd);
  assert.doesNotMatch(selectorBlock, /fetch\(|onSnapshot|getDoc|getDocs|setInterval/);
});

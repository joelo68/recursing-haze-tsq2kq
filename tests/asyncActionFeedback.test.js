import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const EXPECTED_ACTIONS = {
  "src/components/AnnualView.jsx": [
    [
      "onClick={saveConfig}",
      "儲存中…",
      1
    ]
  ],
  "src/components/AuditView.jsx": [
    [
      "onClick={saveConfig}",
      "儲存中…",
      1
    ]
  ],
  "src/components/DailyView.jsx": [
    [
      "onClick={saveConfig}",
      "儲存中…",
      1
    ]
  ],
  "src/components/HistoryView.jsx": [
    [
      "onClick={saveEdit}",
      "儲存中…",
      1
    ]
  ],
  "src/components/SystemMonitor.jsx": [
    [
      "onClick={fetchDeviceProfiles}",
      "載入中…",
      1
    ]
  ],
  "src/components/TelegramAlertControlCenter.jsx": [
    [
      "onClick={cleanupPolicyConflicts}",
      "整理中…",
      1
    ]
  ],
  "src/components/TherapistScheduleView.jsx": [
    [
      "onClick={handleSaveTherapistSchedule}",
      "儲存中…",
      1
    ]
  ],
  "src/components/TherapistTargetView.jsx": [
    [
      "onClick={handleSaveTherapistTargets}",
      "儲存中…",
      1
    ]
  ],
  "src/components/RankingView.jsx": [
    [
      "onClick={saveConfig}",
      "儲存中…",
      1
    ]
  ],
  "src/components/SmartForecastAccuracyPanel.jsx": [
    [
      "onClick={openHistory}",
      "載入中…",
      1
    ]
  ],
  "src/components/SettingsView.jsx": [
    [
      "onClick={handleSaveTargets}",
      "儲存中…",
      2
    ],
    [
      "onClick={handleSavePermissions}",
      "儲存中…",
      1
    ],
    [
      "onClick={handleSaveSecurityConfig}",
      "儲存中…",
      1
    ],
    [
      "onClick={handleSaveFeatureFlags}",
      "儲存中…",
      1
    ],
    [
      "onClick={handleAddDirectorAccount}",
      "新增中…",
      1
    ],
    [
      "onClick={() => handleRenameDirector(account)}",
      "儲存中…",
      1
    ],
    [
      "onClick={() => handleResetDirectorPassword(account)}",
      "重設中…",
      1
    ],
    [
      "onClick={() => handleToggleDirectorAccount(account)}",
      "更新中…",
      1
    ],
    [
      "onClick={() => handleDeleteDirectorAccount(account)}",
      "刪除中…",
      1
    ],
    [
      "onClick={handleAddTrainerAccount}",
      "新增中…",
      1
    ],
    [
      "onClick={() => moveTrainerAccount(account.id, -1)}",
      "排序中…",
      1
    ],
    [
      "onClick={() => moveTrainerAccount(account.id, 1)}",
      "排序中…",
      1
    ],
    [
      "onClick={() => handleSaveTrainerAccount(account.id)}",
      "儲存中…",
      1
    ],
    [
      "onClick={() => handleResetTrainerPassword(account)}",
      "重設中…",
      1
    ],
    [
      "onClick={() => handleToggleTrainerAccount(account)}",
      "更新中…",
      1
    ],
    [
      "onClick={() => handleDeleteTrainerAccount(account)}",
      "刪除中…",
      1
    ],
    [
      "onClick={handleAddGlobalStore}",
      "新增中…",
      1
    ],
    [
      "onClick={() => handleDeleteGlobalStore(store, mgr)}",
      "處理中…",
      1
    ],
    [
      "onClick={handleAddStoreAccount}",
      "新增中…",
      1
    ],
    [
      "onClick={() => handleResetStorePassword(account)}",
      "重設中…",
      1
    ],
    [
      "onClick={() => handleDeleteStoreAccount(account.id)}",
      "刪除中…",
      1
    ],
    [
      "onClick={handleUpdateStoreAccount}",
      "儲存中…",
      1
    ],
    [
      "onClick={handleAddManager}",
      "新增中…",
      1
    ],
    [
      "onClick={() => handleResetManagerPassword(managerName)}",
      "重設中…",
      1
    ],
    [
      "onClick={() => handleDeleteManager(managerName)}",
      "刪除中…",
      1
    ],
    [
      "onClick={() => handleSaveManagerStores(managerName)}",
      "儲存中…",
      1
    ],
    [
      "onClick={() => handleEndDelegation(item)}",
      "結束中…",
      1
    ]
  ]
};

const assertWrapped = (source, fragment) => {
  const idx = source.indexOf(fragment);
  assert.notEqual(idx, -1, `missing action fragment: ${fragment}`);
  const asyncStart = source.lastIndexOf("<AsyncActionButton", idx);
  const nativeStart = source.lastIndexOf("<button", idx);
  assert.ok(asyncStart > nativeStart, `action is not wrapped by AsyncActionButton: ${fragment}`);
};

test("Global Async Action Feedback v1 has a shared Promise-aware owner", () => {
  const source = read("src/components/SharedUI.jsx");
  assert.match(source, /export const AsyncActionButton/);
  assert.match(source, /data-async-feedback="v1"/);
  assert.match(source, /busyRef/);
  assert.match(source, /typeof result\.then !== "function"/);
  assert.match(source, /Loader2/);
  assert.match(source, /aria-busy=/);
  assert.doesNotMatch(source, /firebase\/firestore|onSnapshot|getDocs|setInterval/);
});

test("all v1 inventory actions are wired to the shared async feedback control", () => {
  for (const [file, specs] of Object.entries(EXPECTED_ACTIONS)) {
    const source = read(file);
    assert.match(source, /AsyncActionButton/);
    for (const [fragment, _loadingText, expectedCount] of specs) {
      const count = source.split(fragment).length - 1;
      assert.equal(count, expectedCount, `${file} fragment count changed: ${fragment}`);
      assertWrapped(source, fragment);
    }
  }
});

test("existing specialized progress controls remain specialized", () => {
  assert.match(read("src/components/InputView.jsx"), /isSubmitting/);
  assert.match(read("src/components/TargetView.jsx"), /isSaving/);
  assert.match(read("src/components/StoreLifecycleManager.jsx"), /batchSaving/);
  assert.match(read("src/components/SystemMaintenance.jsx"), /loadingAction/);
  assert.match(read("src/components/NotificationManager.jsx"), /isSaving/);
});

test("v1 stays frontend-only and does not bump the app version", () => {
  assert.match(read("src/App.jsx"), /const CURRENT_APP_VERSION = "3\.6\.0";/);
  assert.doesNotMatch(read("src/components/SharedUI.jsx"), /firebase|Firestore/);
});

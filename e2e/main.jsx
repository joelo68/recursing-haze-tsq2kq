import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";

import { AppContext } from "../src/AppContext";
import LoginView from "../src/components/LoginView";
import DeviceApprovalGate from "../src/components/DeviceApprovalGate";
import { Sidebar, MobileTopNav } from "../src/components/Navigation";
import { AsyncActionButton } from "../src/components/SharedUI";
import SystemMonitor from "../src/components/SystemMonitor";
import TherapistManagerView from "../src/components/TherapistManagerView";

const loginDirectory = {
  version: "application-login-directory-v1",
  brandId: "cyj",
  directors: [
    {
      id: "director-e2e",
      name: "測試總經理",
      level: "super_admin",
      isActive: true,
      sortOrder: 1,
    },
  ],
  trainers: [
    {
      id: "trainer-e2e",
      name: "測試教專",
      isActive: true,
      sortOrder: 1,
    },
  ],
  managers: [
    {
      id: "北區",
      name: "北區",
      isActive: true,
    },
  ],
  stores: [
    {
      id: "store-e2e",
      name: "測試店店經理",
      stores: ["測試店"],
      isActive: true,
    },
  ],
  therapists: [
    {
      id: "therapist-e2e",
      name: "測試管理師",
      store: "測試店",
      storeName: "測試店",
      stores: ["測試店"],
      isActive: true,
    },
  ],
};

const managers = {
  北區: ["測試店"],
};

const LoginHarness = () => {
  const [brandId, setBrandId] = useState("cyj");
  const [result, setResult] = useState("NOT_CALLED");

  const directory = useMemo(() => ({
    ...loginDirectory,
    brandId,
  }), [brandId]);

  return (
    <>
      <LoginView
        appVersion="3.6.0"
        onLogin={async (roleId, userInfo, credential) => {
          if (credential?.password === "wrong-pass") {
            setResult(`REJECTED:${roleId}:${credential?.accountId || ""}`);
            return {
              ok: false,
              credentialRejected: true,
              message: "測試密碼錯誤",
            };
          }

          setResult(`LOGIN_OK:${roleId}:${credential?.accountId || ""}`);
          return {
            ok: true,
            user: userInfo,
          };
        }}
        onChangeApplicationPassword={async () => ({ ok: true })}
        onSecurityEvent={async () => ({ ok: true })}
        loginDirectory={directory}
        managers={managers}
        managerOrder={["北區"]}
        currentBrandId={brandId}
        onSwitchBrand={setBrandId}
        hasSelectedBrand={false}
        accountDirectoryStatus="ready"
      />
      <div data-testid="login-result" className="fixed bottom-2 left-2 z-[99999] rounded bg-white px-2 py-1 text-[10px]">
        {result}
      </div>
    </>
  );
};

const NavigationHarness = () => {
  const [active, setActive] = useState("dashboard");
  const permissions = {
    manager: ["dashboard", "annual"],
  };

  const contextValue = {
    currentBrand: { id: "cyj", label: "CYJ" },
    therapistModuleEnabled: true,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div className="hidden md:block">
        <Sidebar
          activeView={active}
          setActiveView={setActive}
          isSidebarOpen={true}
          setSidebarOpen={() => {}}
          userRole="manager"
          onLogout={() => setActive("logout")}
          permissions={permissions}
          currentUser={{ name: "測試區長" }}
          canAccessView={(viewId) => permissions.manager.includes(viewId)}
        />
      </div>

      <MobileTopNav
        activeView={active}
        setActiveView={setActive}
        permissions={permissions}
        userRole="manager"
        onLogout={() => setActive("logout")}
        canAccessView={(viewId) => permissions.manager.includes(viewId)}
      />

      <main className="p-6 md:ml-64">
        <h1 className="text-xl font-black">權限與導覽測試</h1>
        <div data-testid="active-view" className="mt-4">
          ACTIVE:{active}
        </div>
      </main>
    </AppContext.Provider>
  );
};

const SaveHarness = () => {
  const [runCount, setRunCount] = useState(0);
  const [status, setStatus] = useState("IDLE");

  const save = async () => {
    setRunCount((value) => value + 1);
    setStatus("RUNNING");
    await new Promise((resolve) => setTimeout(resolve, 550));
    setStatus("SAVED");
  };

  return (
    <div className="min-h-screen bg-stone-50 p-8">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-black text-stone-800">管理設定儲存</h1>
        <p className="mt-2 text-sm text-stone-500">驗證等待提示與重複點擊防護。</p>

        <AsyncActionButton
          data-testid="save-action"
          onClick={save}
          loadingText="儲存中…"
          className="mt-6 w-full rounded-xl bg-amber-500 px-4 py-3 font-black text-white disabled:opacity-60"
        >
          儲存設定
        </AsyncActionButton>

        <div data-testid="save-run-count" className="mt-4 text-sm">COUNT:{runCount}</div>
        <div data-testid="save-status" className="mt-1 text-sm">STATUS:{status}</div>
      </div>
    </div>
  );
};


const TrainerTherapistHarness = () => {
  const [active, setActive] = useState("dashboard");
  const [actionLog, setActionLog] = useState([]);
  const permissions = {
    trainer: ["dashboard", "therapist-manager"],
  };

  const therapist = {
    id: "therapist-e2e",
    name: "測試管理師",
    store: "測試店",
    storeName: "測試店",
    stores: ["測試店"],
    onboardDate: "2026-09-01",
    resignDate: "",
    isActive: true,
    status: "active",
    masterSignature: "sig-e2e-1",
    credentialStorageMode: "separated_v1",
  };

  const recordAction = (action) => {
    setActionLog((current) => [...current, action]);
  };

  const manageTherapistMasterAction = async (request = {}) => {
    const action = String(request.action || "");
    recordAction(action);

    if (action === "delete") {
      throw new Error("E2E trainer must never reach permanent delete");
    }

    if (action === "get") {
      return {
        ok: true,
        therapist,
        masterSignature: therapist.masterSignature,
      };
    }

    if (action === "update") {
      const next = {
        ...therapist,
        ...(request.payload || {}),
      };
      return {
        ok: true,
        therapist: next,
        masterSignature: "sig-e2e-update",
      };
    }

    if (action === "archive") {
      return {
        ok: true,
        therapist: {
          ...therapist,
          isActive: false,
          status: "封存",
          resignDate: "2026-09-30",
        },
        masterSignature: "sig-e2e-archive",
      };
    }

    if (action === "restore") {
      return {
        ok: true,
        therapist: {
          ...therapist,
          isActive: true,
          status: "active",
          resignDate: "",
        },
        masterSignature: "sig-e2e-restore",
      };
    }

    if (action === "reset_password") {
      return {
        ok: true,
        therapist,
        masterSignature: "sig-e2e-reset",
      };
    }

    if (action === "create") {
      const created = {
        ...therapist,
        id: "therapist-created-e2e",
        name: String(request.payload?.name || "新增管理師"),
        store: String(request.payload?.store || "測試"),
      };
      return {
        ok: true,
        therapist: created,
        masterSignature: "sig-e2e-create",
      };
    }

    throw new Error(`unexpected trainer therapist action: ${action}`);
  };

  const manageApplicationAccountAction = async (request = {}) => {
    recordAction(`FORBIDDEN_ACCOUNT_ACTION:${String(request.action || "")}`);
    throw new Error("E2E trainer must never reach credential reveal authority");
  };

  const contextValue = {
    currentBrand: { id: "cyj", label: "CYJ" },
    therapistModuleEnabled: true,
    therapists: [therapist],
    managers,
    managerOrder: ["北區"],
    showToast: () => {},
    manageTherapistMasterAction,
    manageApplicationAccountAction,
    canRevealTherapistPassword: false,
    canDeleteTherapistAccount: false,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <div className="hidden md:block">
        <Sidebar
          activeView={active}
          setActiveView={setActive}
          isSidebarOpen={true}
          setSidebarOpen={() => {}}
          userRole="trainer"
          onLogout={() => setActive("logout")}
          permissions={permissions}
          currentUser={{ id: "trainer-e2e", name: "測試教專" }}
          canAccessView={(viewId) => permissions.trainer.includes(viewId)}
        />
      </div>

      <main className="min-h-screen bg-stone-50 p-6 md:ml-64">
        {active === "therapist-manager" ? (
          <>
            <div data-testid="trainer-therapist-ready">READY</div>
            <TherapistManagerView />
          </>
        ) : (
          <div data-testid="trainer-dashboard">TRAINER_DASHBOARD</div>
        )}

        <div data-testid="trainer-action-log" className="fixed bottom-2 right-2 z-[99999] rounded bg-white px-2 py-1 text-[10px]">
          {actionLog.join(",")}
        </div>
      </main>
    </AppContext.Provider>
  );
};

const SecurityHarness = () => {
  const [status, setStatus] = useState("BLOCKED");

  const approval = {
    verificationCode: "123456",
    expiresAtMs: Date.now() + 10 * 60 * 1000,
    deviceInfo: {
      device: "測試手機",
      browser: "測試瀏覽器",
      deviceShort: "E2E001",
      deviceId: "e2e-device-001",
    },
    adminOnly: false,
    selfApprovalAllowed: true,
    hasTrustedApproverDevice: true,
    deviceStatus: "new",
  };

  if (status === "RETURNED") {
    return <div data-testid="security-result" className="p-8 text-xl font-black">RETURNED</div>;
  }

  return (
    <>
      <DeviceApprovalGate
        approval={approval}
        requestRef={null}
        onApproved={() => setStatus("APPROVED")}
        onCancel={() => setStatus("RETURNED")}
        onEmergencyRecovery={async () => ({ ok: true })}
      />
      <div data-testid="security-state" className="fixed bottom-2 left-2 z-[99999] rounded bg-white px-2 py-1 text-[10px]">
        {status}
      </div>
    </>
  );
};

const HealthHarness = () => {
  const contextValue = {
    currentBrand: { id: "cyj", label: "CYJ" },
    currentUser: { id: "director-e2e", name: "測試總經理" },
    userRole: "director",
    currentDeviceTrust: { status: "trusted" },
    currentSecurityAccountKey: "cyj_director_director-e2e",
    canManageDeviceSecurity: true,
    manageDeviceSecurityAction: async () => ({ ok: true }),
    reviewDeviceApprovalAction: async () => ({ ok: true }),
    getCollectionPath: () => null,
    getProductionHealthSnapshotAction: async () => ({
      ok: true,
      snapshot: {
        schemaVersion: "production-observability-v1",
        brandId: "cyj",
        brandLabel: "CYJ",
        generatedAtText: "2026-09-24T05:30:00.000Z",
        overall: {
          status: "healthy",
          label: "整體運作正常",
          detail: "目前沒有發現需要立即處理的系統狀態。",
        },
        summary: {
          status: "healthy",
          previousYearMonth: "2026-08",
          previousVerified: true,
          unresolvedCount: 0,
          unresolvedMonths: [],
        },
        security: {
          status: "healthy",
          pendingCount: 0,
          adminAssistancePendingCount: 0,
        },
        usage: {
          status: "healthy",
          todayLoginCount: 12,
          yesterdayLoginCount: 20,
        },
        readTracking: {
          status: "healthy",
          mode: "off",
          scheduleEnabled: true,
          startTime: "19:00",
          endTime: "07:00",
        },
        maintenance: {
          status: "healthy",
          recentCount: 1,
          failureCount: 0,
          rows: [
            {
              id: "m1",
              type: "summary",
              action: "自動資料整理",
              status: "success",
              failed: false,
              month: "2026-08",
              createdAtText: "2026-09-24T04:00:00.000Z",
            },
          ],
        },
        diagnostics: {
          sourceErrors: [],
          maxDocumentReadBudget: 21,
        },
      },
    }),
  };

  return (
    <AppContext.Provider value={contextValue}>
      <SystemMonitor />
    </AppContext.Provider>
  );
};

const Harness = () => {
  const testCase = new URLSearchParams(window.location.search).get("case") || "login";

  if (testCase === "navigation") return <NavigationHarness />;
  if (testCase === "save") return <SaveHarness />;
  if (testCase === "trainer-therapist") return <TrainerTherapistHarness />;
  if (testCase === "security") return <SecurityHarness />;
  if (testCase === "health") return <HealthHarness />;
  return <LoginHarness />;
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);

// src/components/LoginView.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { 
  Coffee, AlertCircle, Loader2, MapPin, Store, UserCheck, Lock, 
  Sparkles, Crown, ArrowRight, ChevronLeft, Heart, CheckCircle2, RefreshCw 
} from "lucide-react";
import { ROLES, BRANDS } from "../constants/index"; 
import { sortManagersByOrgOrder, sortStoresByOrgOrder, sortTherapistsByStoreThenName, normalizeStoreCoreName, zhCompare } from "../utils/helpers";
import LoginCounter from './LoginCounter';

const LoginView = ({
  appVersion = "2.2.5",
  onLogin,
  onChangeApplicationPassword,
  loginDirectory = {},
  managers,
  managerOrder = [],
  currentBrandId,
  onSwitchBrand,
  hasSelectedBrand = false,
  accountDirectoryStatus = "ready",
  accountDirectoryError = "",
  onRetryAccountDirectory = null,
  onSecurityEvent = null,
}) => {
  const [showBrandSelector, setShowBrandSelector] = useState(!hasSelectedBrand);

  const [role, setRole] = useState("director");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [forcePasswordUpdate, setForcePasswordUpdate] = useState(null);
  const [forceNewPassword, setForceNewPassword] = useState("");
  const [forceConfirmPassword, setForceConfirmPassword] = useState("");
  

  const [tRegion, setTRegion] = useState("");   
  const [tStore, setTStore] = useState("");     
  const [tPersonId, setTPersonId] = useState(""); 
  const [tPassword, setTPassword] = useState(""); 

  const currentBrandConfig = useMemo(() => 
    BRANDS.find(b => b.id === currentBrandId) || BRANDS[0]
  , [currentBrandId]);

  const themeColors = useMemo(() => {
    switch(currentBrandId) {
      case 'anniu': return { text: "text-rose-900", accent: "bg-rose-600 hover:bg-rose-700", border: "focus:border-rose-400", ring: "focus:ring-rose-100", soft: "bg-rose-50/80 border-rose-100", glow: "shadow-rose-100/80", statusText: "text-rose-700", dot: "bg-rose-400" };
      case 'yibo': return { text: "text-yellow-900", accent: "bg-yellow-500 hover:bg-yellow-600", border: "focus:border-yellow-400", ring: "focus:ring-yellow-100", soft: "bg-yellow-50/80 border-yellow-100", glow: "shadow-yellow-100/80", statusText: "text-yellow-700", dot: "bg-yellow-400" };
      default: return { text: "text-stone-800", accent: "bg-stone-800 hover:bg-stone-900", border: "focus:border-stone-400", ring: "focus:ring-stone-100", soft: "bg-stone-100/80 border-stone-200", glow: "shadow-stone-200/70", statusText: "text-stone-600", dot: "bg-stone-400" }; 
    }
  }, [currentBrandId]);

  // ★ 快速網路也能清楚感受到的精緻三階段轉場：同步 → 完成 → 內容進場。
  // 最少保留 650ms 同步辨識、完成後 280ms 開放內容，整體視覺約 1.8 秒自然收尾。
  const [directoryVisualStage, setDirectoryVisualStage] = useState("syncing");
  const [directoryContentVisible, setDirectoryContentVisible] = useState(false);
  const directoryContentVisibleRef = useRef(false);
  const directoryEntryStartedAtRef = useRef(Date.now());
  const directoryTransitionTokenRef = useRef(0);

  const publishDirectoryContentVisible = useCallback((visible) => {
    directoryContentVisibleRef.current = visible;
    setDirectoryContentVisible(visible);
  }, []);

  useEffect(() => {
    // 品牌選擇畫面開啟時不在背景偷偷播完動畫；真正進入登入卡片後再開始完整轉場。
    if (showBrandSelector) return;
    directoryTransitionTokenRef.current += 1;
    directoryEntryStartedAtRef.current = Date.now();
    directoryContentVisibleRef.current = false;
    setDirectoryContentVisible(false);
    setDirectoryVisualStage("syncing");
  }, [currentBrandId, showBrandSelector, publishDirectoryContentVisible]);

  useEffect(() => {
    const transitionToken = directoryTransitionTokenRef.current;
    const timers = [];
    const schedule = (callback, delayMs) => {
      const timer = setTimeout(() => {
        if (transitionToken === directoryTransitionTokenRef.current) callback();
      }, Math.max(0, delayMs));
      timers.push(timer);
    };

    if (showBrandSelector) return () => timers.forEach((timer) => clearTimeout(timer));

    const status = accountDirectoryStatus || "loading";

    if (status === "idle" || status === "loading") {
      setDirectoryVisualStage("syncing");
      if (!directoryContentVisibleRef.current) publishDirectoryContentVisible(false);
    } else if (status === "refreshing") {
      if (directoryContentVisibleRef.current) {
        setDirectoryVisualStage("refreshing");
      } else {
        setDirectoryVisualStage("syncing");
      }
    } else if (status === "ready") {
      if (directoryContentVisibleRef.current) {
        setDirectoryVisualStage("complete");
        schedule(() => setDirectoryVisualStage("settled"), 700);
      } else {
        const elapsedMs = Date.now() - directoryEntryStartedAtRef.current;
        const minimumSyncRemaining = Math.max(0, 650 - elapsedMs);

        // 快速載入時仍完整保留同步辨識；資料較慢時則只多等 280ms 就開放操作，
        // 完成提示與人數動畫繼續自然播放，不讓畫面突然跳到最終狀態。
        schedule(() => setDirectoryVisualStage("complete"), minimumSyncRemaining);
        schedule(() => publishDirectoryContentVisible(true), minimumSyncRemaining + 280);
        schedule(() => setDirectoryVisualStage("settled"), minimumSyncRemaining + 1150);
      }
    } else if (status === "error") {
      const elapsedMs = Date.now() - directoryEntryStartedAtRef.current;
      schedule(() => {
        publishDirectoryContentVisible(false);
        setDirectoryVisualStage("error");
      }, Math.max(0, 650 - elapsedMs));
    }

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [accountDirectoryStatus, currentBrandId, showBrandSelector, publishDirectoryContentVisible]);

  const counterVisualStatus = directoryVisualStage === "syncing"
    ? "loading"
    : directoryVisualStage === "error"
      ? "error"
      : directoryVisualStage === "refreshing"
        ? "refreshing"
        : directoryVisualStage === "complete"
          ? "complete"
          : "ready";

  // P0-B1C2C1：LoginView 只接受 Backend sanitized directory。
  // 此元件不得再取得任何角色的 password / secret / token。
  const directory = loginDirectory && typeof loginDirectory === "object" ? loginDirectory : {};
  const storeAccounts = Array.isArray(directory.stores) ? directory.stores : [];
  const therapists = Array.isArray(directory.therapists) ? directory.therapists : [];
  const managerAccounts = Array.isArray(directory.managers) ? directory.managers : [];
  const trainerAccounts = Array.isArray(directory.trainers) ? directory.trainers : [];
  const directorAccounts = Array.isArray(directory.directors) ? directory.directors : [];

  const visibleManagerNames = useMemo(() => {
    return sortManagersByOrgOrder(
      managers || {},
      Object.keys(managers || {}).filter((name) => {
        const text = String(name || "");
        return !text.includes("未分配") && !text.includes("未分區") && !text.includes("其他");
      }),
      managerOrder
    );
  }, [managers, managerOrder]);

  const sortedStoreAccounts = useMemo(() => {
    const storeRankMap = new Map();
    sortStoresByOrgOrder(
      managers || {},
      Object.values(managers || {}).flat(),
      "",
      managerOrder
    ).forEach((storeName, index) => {
      const core = normalizeStoreCoreName(storeName);
      if (core && !storeRankMap.has(core)) storeRankMap.set(core, index);
    });

    return [...(storeAccounts || [])].sort((a, b) => {
      const aStore = normalizeStoreCoreName((a?.stores || [a?.storeName || ""])[0]);
      const bStore = normalizeStoreCoreName((b?.stores || [b?.storeName || ""])[0]);
      const ar = storeRankMap.has(aStore) ? storeRankMap.get(aStore) : 9999;
      const br = storeRankMap.has(bStore) ? storeRankMap.get(bStore) : 9999;
      if (ar !== br) return ar - br;
      return zhCompare(a?.name || "", b?.name || "");
    });
  }, [storeAccounts, managers, managerOrder]);

  const sortedManagerAccounts = useMemo(() => {
    const byName = new Map(managerAccounts.map((account) => [String(account?.name || account?.id || ""), account]));
    const orderedNames = sortManagersByOrgOrder(
      managers || {},
      managerAccounts.map((account) => String(account?.name || account?.id || "")).filter(Boolean),
      managerOrder
    );
    return orderedNames.map((name) => byName.get(name)).filter((account) => account && account.isActive !== false);
  }, [managerAccounts, managers, managerOrder]);

  const sortedTrainerAccounts = useMemo(() => {
    return [...trainerAccounts]
      .filter((account) => account?.isActive !== false)
      .sort((a, b) => {
        const ar = Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : 9999;
        const br = Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : 9999;
        if (ar !== br) return ar - br;
        return zhCompare(a?.name || "", b?.name || "");
      });
  }, [trainerAccounts]);

  const DIRECTOR_LEVEL_OPTIONS = [
    { value: "super_admin", label: "最高管理者", hint: "系統維護、權限、帳號、裝置與月報管理" },
    { value: "operation_admin", label: "營運主管", hint: "全品牌營運、報表、回報檢核" },
    { value: "finance_admin", label: "財務主管", hint: "報表、匯出、財務檢視" },
    { value: "viewer", label: "只讀主管", hint: "營運總覽與報表檢視" },
  ];

  const getDirectorTitleWeight = (name = "") => {
    const title = String(name ?? "").trim();
    if (title.includes("董事長")) return 1;
    if (title.includes("總經理")) return 2;
    if (title.includes("營運長")) return 3;
    if (title.includes("財務")) return 5;
    if (title.includes("人資") || title.includes("人事")) return 6;
    if (title.includes("總監")) return 4;
    return 9;
  };

  const getDefaultDirectorLevel = (name = "") => {
    if (name.includes("董事長") || name.includes("總經理")) return "super_admin";
    if (name.includes("財務")) return "finance_admin";
    return "operation_admin";
  };

  const getDirectorLevelLabel = (level) => DIRECTOR_LEVEL_OPTIONS.find((item) => item.value === level)?.label || "營運主管";

  const sortedDirectorAccounts = useMemo(() => {
    return [...directorAccounts]
      .filter((account) => account?.isActive !== false)
      .sort((a, b) => {
        const weightA = getDirectorTitleWeight(a?.name || "");
        const weightB = getDirectorTitleWeight(b?.name || "");
        if (weightA !== weightB) return weightA - weightB;
        const orderA = Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : 9999;
        const orderB = Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : 9999;
        if (orderA !== orderB) return orderA - orderB;
        return zhCompare(a?.name || "", b?.name || "");
      });
  }, [directorAccounts]);

  const sortedDirectorNames = useMemo(() => sortedDirectorAccounts.map((account) => String(account?.id || account?.name || "")).filter(Boolean), [sortedDirectorAccounts]);

  const getDirectorAccount = (accountId) => directorAccounts.find((account) => String(account?.id || account?.name || "") === String(accountId || "")) || null;

  const handleInitialBrandSelect = (brandId) => {
    if (onSwitchBrand) onSwitchBrand(brandId);
    setTimeout(() => { setShowBrandSelector(false); }, 150);
  };

  useEffect(() => {
    setTRegion(""); setTStore(""); setTPersonId("");
    setError(""); setPassword(""); setSelectedUser("");
    setForcePasswordUpdate(null); setForceNewPassword(""); setForceConfirmPassword("");
  }, [role, currentBrandId]);

  const getTherapistStoreValue = (therapist = {}) => {
    return therapist.store || therapist.storeName || therapist.primaryStore || (Array.isArray(therapist.stores) ? therapist.stores[0] : "");
  };

  // ★ 新店相容修正：
  // 舊版曾把正式店名「新店」誤裁成「新」。登入與店家篩選時統一視為「新店」，
  // 同時把登入後 currentUser 的 store/storeName/stores 正規化，避免日報繼續寫入「新」。
  const normalizeTherapistStoreCore = (value = "") => {
    const raw = String(value || "").trim();
    const importedCore = normalizeStoreCoreName(raw);
    const compactRaw = raw
      .replace(/^(CYJ|DRCYJ|Anew\s*\(安妞\)|Yibo\s*\(伊啵\)|Anew|Yibo|安妞|伊啵)\s*/i, "")
      .replace(/[　\s]+/g, "")
      .trim();

    if (importedCore === "新" || importedCore === "新店" || compactRaw === "新" || /^新店店?$/.test(compactRaw)) {
      return "新店";
    }

    return importedCore || compactRaw.replace(/店$/, "").trim();
  };

  const getTherapistStoreCore = (therapist = {}) => normalizeTherapistStoreCore(getTherapistStoreValue(therapist));

  const buildTherapistLoginPayload = (therapist = {}) => {
    const canonicalStore = normalizeTherapistStoreCore(getTherapistStoreValue(therapist));
    const canonicalStores = Array.from(new Set([
      ...(Array.isArray(therapist.stores) ? therapist.stores : []),
      canonicalStore,
    ].map((storeName) => normalizeTherapistStoreCore(storeName)).filter(Boolean)));

    return {
      ...therapist,
      store: canonicalStore || getTherapistStoreValue(therapist),
      storeName: canonicalStore || therapist.storeName || getTherapistStoreValue(therapist),
      primaryStore: canonicalStore || therapist.primaryStore || getTherapistStoreValue(therapist),
      stores: canonicalStores.length ? canonicalStores : therapist.stores,
    };
  };

  const isDateReached = (dateValue = "") => {
    const text = String(dateValue || "").trim();
    if (!text) return false;
    const target = new Date(`${text}T23:59:59`);
    if (Number.isNaN(target.getTime())) return false;
    return target.getTime() < Date.now();
  };

  const isTherapistInactive = (therapist = {}) => {
    const statusText = String(therapist?.status || "").trim().toLowerCase();
    return (
      therapist?.isResigned === true ||
      therapist?.resigned === true ||
      therapist?.isActive === false ||
      statusText === "resigned" ||
      statusText === "inactive" ||
      statusText === "離職" ||
      statusText === "停用" ||
      isDateReached(therapist?.resignDate || therapist?.inactiveDate || therapist?.offboardDate)
    );
  };

  const filteredStores = useMemo(() => {
    return tRegion ? sortStoresByOrgOrder(managers || {}, (managers?.[tRegion] || []), "", managerOrder) : [];
  }, [tRegion, managers, managerOrder]);

  const filteredTherapists = useMemo(() => {
    if (!tStore) return [];
    const selectedStoreCore = normalizeTherapistStoreCore(tStore);
    const list = (therapists || []).filter(t => {
      const therapistStoreCore = getTherapistStoreCore(t);
      const therapistStores = Array.isArray(t.stores) ? t.stores.map((s) => normalizeTherapistStoreCore(s)) : [];
      const storeMatched = therapistStoreCore === selectedStoreCore || therapistStores.includes(selectedStoreCore);
      if (!storeMatched) return false;
      return !isTherapistInactive(t);
    });
    return sortTherapistsByStoreThenName(
      list.map((t) => ({
        ...t,
        store: getTherapistStoreValue(t),
      })),
      managers || {},
      "",
      managerOrder
    );
  }, [tStore, therapists, managers, managerOrder]);

 // P0-B1C2C1：授權人數只計 sanitized directory 中的可登入帳號，不再把 master credential 當成一般帳號。
  const totalActiveUsers = useMemo(() => {
    const therapistCount = therapists.filter((therapist) => !isTherapistInactive(therapist)).length;
    const storeCount = storeAccounts.filter((account) => account?.isActive !== false).length;
    const managerCount = managerAccounts.filter((account) => account?.isActive !== false).length;
    const directorCount = directorAccounts.filter((account) => account?.isActive !== false).length;
    const trainerCount = trainerAccounts.filter((account) => account?.isActive !== false).length;
    return therapistCount + storeCount + managerCount + directorCount + trainerCount;
  }, [therapists, storeAccounts, managerAccounts, directorAccounts, trainerAccounts]);

  const getInitialPasswordsForRole = (roleId) => {
    if (roleId === "director") {
      if (currentBrandId === "anniu") return ["8888", "0000"];
      if (currentBrandId === "yibo") return ["9999", "0000"];
      return ["16500", "0000"];
    }
    if (["manager", "store", "therapist", "trainer"].includes(roleId)) return ["0000"];
    return [];
  };

  const looksLikeInitialPassword = (roleId, enteredPassword) => {
    const value = String(enteredPassword || "");
    return Boolean(value && getInitialPasswordsForRole(roleId).includes(value));
  };

  const isWeakNewPassword = (value) => {
    const text = String(value || "").trim();
    if (text.length < 4) return true;
    return ["0000", "1111", "1234", "8888", "9999", "password", "PASSWORD"].includes(text);
  };

  const openForcePasswordUpdate = ({ roleId, accountId, userInfo, currentPassword, displayName }) => {
    setForcePasswordUpdate({ roleId, accountId, userInfo, currentPassword, displayName });
    setForceNewPassword("");
    setForceConfirmPassword("");
    setError("");
  };

  const handleForcePasswordUpdate = async () => {
    if (!forcePasswordUpdate) return;
    const nextPass = String(forceNewPassword || "").trim();
    const confirmPass = String(forceConfirmPassword || "").trim();

    if (!nextPass || !confirmPass) { setError("請輸入新密碼並再次確認"); return; }
    if (nextPass !== confirmPass) { setError("兩次輸入的新密碼不一致"); return; }
    if (nextPass === String(forcePasswordUpdate.currentPassword || "")) { setError("新密碼不可與初始密碼相同"); return; }
    if (isWeakNewPassword(nextPass)) { setError("請設定至少 4 碼，並避免使用 0000、1234、8888、9999 等簡易密碼"); return; }
    if (typeof onChangeApplicationPassword !== "function") { setError("安全密碼服務尚未就緒，請重新整理後再試一次"); return; }

    setIsLoading(true);
    setError("");
    const currentPassword = String(forcePasswordUpdate.currentPassword || "");
    const { roleId, accountId } = forcePasswordUpdate;

    try {
      await onChangeApplicationPassword({ roleId, accountId, currentPassword, newPassword: nextPass });
      const loginPayload = { ...(forcePasswordUpdate.userInfo || {}), passwordUpdatedOnFirstLogin: true };
      const loginRole = forcePasswordUpdate.roleId;
      setForcePasswordUpdate(null);
      setForceNewPassword("");
      setForceConfirmPassword("");
      setPassword("");
      setTPassword("");
      const loginResult = await onLogin(loginRole, loginPayload, { accountId, password: nextPass });
      if (loginResult?.ok === false && !loginResult?.pending && !loginResult?.blocked) {
        setError(loginResult?.message || "安全登入未完成，請重新輸入密碼");
      }
    } catch (error) {
      const code = String(error?.code || error?.result?.code || "");
      if (roleId === "director" && code === "master_override_not_allowed") {
        setForcePasswordUpdate(null);
        setForceNewPassword("");
        setForceConfirmPassword("");
        const loginResult = await onLogin("director", forcePasswordUpdate.userInfo || {}, { accountId, password: currentPassword });
        if (loginResult?.ok === false && !loginResult?.pending && !loginResult?.blocked) {
          setError(loginResult?.message || "最高管理者登入未完成，請重新輸入");
        }
      } else if (["credential_rejected", "credential_changed", "account_missing", "account_inactive"].includes(code)) {
        reportPasswordFailure(roleId, accountId, forcePasswordUpdate.displayName || accountId);
        setError("初始密碼驗證未通過，請重新輸入");
      } else if (code === "weak_new_password" || code === "new_password_too_short") {
        setError("新密碼安全性不足，請重新設定");
      } else {
        console.error("首次密碼更新失敗:", error);
        setError("密碼更新失敗，請稍後再試");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const reportPasswordFailure = useCallback((roleId, accountId, userName = "") => {
    if (typeof onSecurityEvent !== "function" || !roleId || !accountId) return;
    Promise.resolve(onSecurityEvent({
      eventType: "password_failed",
      roleId,
      accountId: String(accountId),
      userName: String(userName || accountId),
    })).catch(() => {});
  }, [onSecurityEvent]);

  const finishBackendLogin = async ({ roleId, accountId, userInfo, passwordValue, displayName }) => {
    const result = await onLogin(roleId, userInfo, { accountId, password: String(passwordValue || "") });
    if (result?.ok === false && !result?.pending && !result?.blocked) {
      if (result?.credentialRejected) {
        reportPasswordFailure(roleId, accountId, displayName || userInfo?.name || accountId);
        setError("密碼錯誤");
      } else {
        setError(result?.message || "登入尚未完成，請稍後再試");
      }
    }
    return result;
  };

  const maybeForceInitialPasswordUpdate = ({ roleId, accountId, userInfo, passwordValue, displayName }) => {
    if (!looksLikeInitialPassword(roleId, passwordValue)) return false;
    openForcePasswordUpdate({ roleId, accountId, userInfo, currentPassword: String(passwordValue || ""), displayName });
    return true;
  };

  const handleAuth = async () => {
    setError("");
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      if (!String(password || "")) { setError("請輸入密碼"); return; }

      if (role === "director") {
        if (!selectedUser) { setError("請選擇高管帳號"); return; }
        const account = getDirectorAccount(selectedUser);
        if (!account || account.isActive === false) { setError("此高階主管帳號已停用"); return; }
        const userInfo = {
          id: account.id || selectedUser,
          name: account.name || selectedUser,
          directorLevel: account.level || getDefaultDirectorLevel(account.name || selectedUser),
          directorLevelLabel: getDirectorLevelLabel(account.level || getDefaultDirectorLevel(account.name || selectedUser)),
        };
        const accountId = account.id || selectedUser;
        if (maybeForceInitialPasswordUpdate({ roleId: "director", accountId, userInfo, passwordValue: password, displayName: userInfo.name })) return;
        await finishBackendLogin({ roleId: "director", accountId, userInfo, passwordValue: password, displayName: userInfo.name });
        return;
      }

      if (role === "trainer") {
        if (!selectedUser) { setError("請選擇教專人員"); return; }
        const account = sortedTrainerAccounts.find((item) => String(item?.id || "") === String(selectedUser));
        if (!account || account.isActive === false) { setError("此教專帳號已停用"); return; }
        const userInfo = { id: account.id, name: account.name || "教專" };
        if (maybeForceInitialPasswordUpdate({ roleId: "trainer", accountId: account.id, userInfo, passwordValue: password, displayName: userInfo.name })) return;
        await finishBackendLogin({ roleId: "trainer", accountId: account.id, userInfo, passwordValue: password, displayName: userInfo.name });
        return;
      }

      if (role === "manager") {
        if (!selectedUser) { setError("請選擇區長"); return; }
        const account = sortedManagerAccounts.find((item) => String(item?.id || item?.name || "") === String(selectedUser));
        if (!account || account.isActive === false) { setError("此區長帳號已停用或尚未建立登入權限"); return; }
        const accountId = account.id || account.name;
        const userInfo = { id: accountId, name: account.name || accountId };
        if (maybeForceInitialPasswordUpdate({ roleId: "manager", accountId, userInfo, passwordValue: password, displayName: userInfo.name })) return;
        await finishBackendLogin({ roleId: "manager", accountId, userInfo, passwordValue: password, displayName: userInfo.name });
        return;
      }

      if (role === "store") {
        if (!selectedUser) { setError("請選擇帳號"); return; }
        const account = sortedStoreAccounts.find((item) => String(item?.id || "") === String(selectedUser));
        if (!account || account.isActive === false) { setError("此店經理帳號已停用"); return; }
        const userInfo = { id: account.id, name: account.name, storeName: account.stores?.[0] || account.storeName, stores: account.stores || [] };
        if (maybeForceInitialPasswordUpdate({ roleId: "store", accountId: account.id, userInfo, passwordValue: password, displayName: account.name })) return;
        await finishBackendLogin({ roleId: "store", accountId: account.id, userInfo, passwordValue: password, displayName: account.name });
      }
    } catch (error) {
      console.error("登入發生錯誤:", error);
      setError("登入發生錯誤，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTherapistLogin = async () => {
    setError("");
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      if (!tPersonId) { setError("請選擇姓名"); return; }
      if (!String(tPassword || "")) { setError("請輸入密碼"); return; }
      const therapist = therapists.find((item) => String(item?.id || "") === String(tPersonId));
      if (!therapist) { setError("找不到此管理師帳號，請重新同步授權名單"); return; }
      if (isTherapistInactive(therapist)) { setError("此帳號已停用"); return; }
      const normalizedTherapist = buildTherapistLoginPayload(therapist);
      if (maybeForceInitialPasswordUpdate({ roleId: "therapist", accountId: therapist.id, userInfo: normalizedTherapist, passwordValue: tPassword, displayName: therapist.name })) return;
      await finishBackendLogin({ roleId: "therapist", accountId: therapist.id, userInfo: normalizedTherapist, passwordValue: tPassword, displayName: therapist.name });
    } catch (error) {
      console.error("管理師登入發生錯誤:", error);
      setError("登入發生錯誤，請稍後再試");
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring}`;
  const selectClass = `w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none text-stone-700 appearance-none transition-all focus:border-stone-400 focus:ring-2 ${themeColors.ring} disabled:bg-stone-50 disabled:text-stone-400`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-4 font-sans text-stone-800">
      
      <div className={`w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-stone-200 transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
        <button onClick={() => setShowBrandSelector(true)} className="absolute top-6 left-6 text-stone-400 hover:text-stone-600 transition-colors flex items-center gap-1 text-sm font-medium"><ChevronLeft size={16}/> 切換品牌</button>

        <div className="text-center mb-7 mt-2">
          <div className="flex justify-center mb-4">
            <div className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border ${themeColors.soft} shadow-lg ${themeColors.glow} transition-all duration-700 ${directoryVisualStage === "syncing" ? "scale-[0.98]" : "scale-100"}`}>
              {directoryVisualStage === "syncing" && (
                <span className={`absolute inset-2 rounded-xl ${themeColors.dot} opacity-10 animate-ping`} />
              )}
              {currentBrandId === 'yibo' ? <Sparkles size={34} className={`${themeColors.text} relative z-10`} strokeWidth={1.5} /> : 
                currentBrandId === 'anniu' ? <Heart size={34} className={`${themeColors.text} relative z-10`} strokeWidth={1.5} /> :
                <Crown size={34} className={`${themeColors.text} relative z-10`} strokeWidth={1.5} />}
              {directoryVisualStage === "complete" && (
                <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white shadow-sm animate-in zoom-in duration-500">
                  <CheckCircle2 size={15} strokeWidth={2.5} />
                </span>
              )}
            </div>
          </div>
          <h1 className={`text-2xl font-bold tracking-tight ${themeColors.text}`}>{currentBrandConfig.label} 營運管理</h1>
          <p className="text-stone-400 text-sm mt-1">請登入您的帳戶</p>

          <div className="mt-3 flex h-7 items-center justify-center" aria-live="polite">
            {directoryVisualStage === "syncing" && (
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${themeColors.soft} ${themeColors.statusText} animate-in fade-in duration-500`}>
                <Loader2 size={12} className="animate-spin" />
                <span>正在同步授權名單</span>
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  {[0, 1, 2].map((index) => (
                    <span key={index} className={`h-1 w-1 rounded-full ${themeColors.dot} animate-bounce`} style={{ animationDelay: `${index * 160}ms`, animationDuration: "1200ms" }} />
                  ))}
                </span>
              </div>
            )}
            {directoryVisualStage === "refreshing" && (
              <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-[11px] font-bold text-stone-500 animate-in fade-in duration-300">
                <RefreshCw size={12} className="animate-spin" />
                背景確認名單中
              </div>
            )}
            {directoryVisualStage === "complete" && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-[11px] font-bold text-emerald-700 animate-in fade-in slide-in-from-bottom-1 duration-500">
                <CheckCircle2 size={13} />
                授權名單已同步
              </div>
            )}
            {directoryVisualStage === "error" && (
              <button
                type="button"
                onClick={() => onRetryAccountDirectory?.()}
                className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50/80 px-3 py-1 text-[11px] font-bold text-rose-600 transition-colors hover:bg-rose-100"
              >
                <AlertCircle size={12} />
                名單同步未完成・重新載入
              </button>
            )}
          </div>
        </div>

        {directoryContentVisible ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
        <div className="flex justify-center mb-8 border-b border-stone-100 pb-1 animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
          {Object.entries(ROLES).map(([key, r]) => (
            <button
              key={key}
              onClick={() => { setRole(r.id); setError(""); setPassword(""); setSelectedUser(""); setTRegion(""); setTStore(""); setTPersonId(""); setTPassword(""); }}
              className={`px-4 py-2 text-sm font-medium transition-all relative ${role === r.id ? `text-stone-800` : "text-stone-400 hover:text-stone-600"}`}
            >
              {r.id === 'director' ? '高階主管' : r.label}
              {role === r.id && <span className="absolute bottom-[-5px] left-0 w-full h-[2px] bg-stone-800 rounded-full"></span>}
            </button>
          ))}
        </div>

        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-700" style={{ animationDelay: "260ms", animationFillMode: "both" }}>
          {forcePasswordUpdate ? (
            <div className="space-y-5 animate-in fade-in duration-300">
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-white p-2 text-amber-600 shadow-sm">
                    <Lock size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-stone-800">首次安全更新</h3>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-stone-500">
                      為保護您的個人業績與門市資料，首次登入請先更新密碼。完成後即可進入系統。
                    </p>
                    <p className="mt-2 text-[11px] font-bold text-stone-500">
                      帳號：{forcePasswordUpdate.displayName || forcePasswordUpdate.userInfo?.name || "目前帳號"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  value={forceNewPassword}
                  onChange={(e) => setForceNewPassword(e.target.value)}
                  placeholder="設定新密碼"
                  className={inputClass}
                  autoFocus
                />
                <input
                  type="password"
                  value={forceConfirmPassword}
                  onChange={(e) => setForceConfirmPassword(e.target.value)}
                  placeholder="再次輸入新密碼"
                  className={inputClass}
                  onKeyDown={(e) => e.key === "Enter" && handleForcePasswordUpdate()}
                />
                <p className="text-[11px] leading-relaxed text-stone-400">
                  請避免使用 0000、1234、8888、9999，或與姓名相同的簡易密碼。
                </p>
              </div>

              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}

              <button
                onClick={handleForcePasswordUpdate}
                disabled={isLoading}
                className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}
              >
                {isLoading ? <Loader2 className="animate-spin mx-auto" /> : "完成更新並進入系統"}
              </button>
            </div>
          ) : (
            <>
          {role === "therapist" ? (
            <>
              <div className="relative"><MapPin className="absolute left-4 top-3.5 text-stone-400" size={18} />
                <select value={tRegion} onChange={(e) => { setTRegion(e.target.value); setTStore(""); setTPersonId(""); }} className={`${selectClass} pl-12`}><option value="">選擇區域</option>{visibleManagerNames.map((m) => (<option key={m} value={m}>{m}區</option>))}</select>
              </div>
              <div className="relative"><Store className="absolute left-4 top-3.5 text-stone-400" size={18} />
                <select value={tStore} onChange={(e) => { setTStore(e.target.value); setTPersonId(""); }} disabled={!tRegion} className={`${selectClass} pl-12`}><option value="">選擇店家</option>{filteredStores.map((storeName) => (<option key={storeName} value={storeName}>{storeName}</option>))}</select>
              </div>
              <div className="relative"><UserCheck className="absolute left-4 top-3.5 text-stone-400" size={18} />
                <select value={tPersonId} onChange={(e) => setTPersonId(e.target.value)} disabled={!tStore} className={`${selectClass} pl-12`}><option value="">選擇姓名</option>{filteredTherapists.map((therapist) => (<option key={therapist.id} value={therapist.id}>{therapist.name}</option>))}</select>
              </div>
              <div className="relative"><Lock className="absolute left-4 top-3.5 text-stone-400" size={18} />
                <input type="password" value={tPassword} onChange={(e) => setTPassword(e.target.value)} placeholder="輸入密碼" className={`${inputClass} pl-12`} onKeyDown={(e) => e.key === "Enter" && handleTherapistLogin()} />
              </div>
              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}
              <button onClick={handleTherapistLogin} disabled={isLoading || !tPersonId || !tPassword} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "登入"}</button>
            </>
          ) : (
            <>
              {role === "director" && <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇高階主管</option>{sortedDirectorAccounts.map((account) => (<option key={account.id || account.name} value={account.id || account.name}>{account.name}</option>))}</select></div>}
              {role === "manager" && <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇區長</option>{sortedManagerAccounts.map((account) => (<option key={account.id || account.name} value={account.id || account.name}>{account.name || account.id}</option>))}</select></div>}
              {role === "trainer" && <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇教專人員</option>{sortedTrainerAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name}</option>))}</select></div>}
              {role === "store" && <div className="relative"><select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={selectClass}><option value="">選擇店經理</option>{sortedStoreAccounts.map((account) => (<option key={account.id} value={account.id}>{account.name}</option>))}</select></div>}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={role === "director" ? "輸入密碼或最高管理金鑰" : "輸入密碼"} className={inputClass} onKeyDown={(e) => e.key === "Enter" && handleAuth()} />
              <p className="px-1 text-center text-[11px] font-medium leading-5 text-stone-400">密碼只會送往安全登入服務驗證，不會下載或顯示正式帳號密碼。帳號管理請登入系統後由授權管理者操作。</p>
              {error && <div className="text-rose-500 text-sm font-medium flex items-center justify-center gap-2 py-1"><AlertCircle size={14} /> {error}</div>}
              <button onClick={handleAuth} disabled={isLoading} className={`w-full py-3.5 text-white rounded-lg font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${themeColors.accent}`}>{isLoading ? <Loader2 className="animate-spin mx-auto" /> : "登入"}</button>
            </>
          )}
            </>
          )}
        </div>
          </div>
        ) : (
          <div className="min-h-[330px] animate-in fade-in duration-300" aria-busy={directoryVisualStage !== "error"}>
            {directoryVisualStage === "error" ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-rose-100 bg-rose-50/40 px-6 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-rose-500 shadow-sm">
                  <AlertCircle size={22} />
                </div>
                <h3 className="text-sm font-black text-stone-700">授權名單同步未完成</h3>
                <p className="mt-2 max-w-xs text-xs font-medium leading-5 text-stone-400">
                  {accountDirectoryError || "可能是行動網路切換或連線暫時不穩，既有資料不會被清除。"}
                </p>
                <button
                  type="button"
                  onClick={() => onRetryAccountDirectory?.()}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-rose-100 bg-white px-4 py-2 text-xs font-black text-rose-600 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <RefreshCw size={14} />
                  重新載入授權名單
                </button>
              </div>
            ) : (
              <>
                <div className="mb-8 flex justify-center gap-3 border-b border-stone-100 pb-3">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <div
                      key={index}
                      className="h-7 rounded-full bg-stone-100 animate-pulse"
                      style={{ width: index === 0 ? 62 : 46, animationDelay: `${index * 120}ms`, animationDuration: "1500ms" }}
                    />
                  ))}
                </div>
                <div className="space-y-3">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="relative h-12 overflow-hidden rounded-xl border border-stone-100 bg-stone-50 animate-pulse"
                      style={{ animationDelay: `${index * 160}ms`, animationDuration: "1500ms" }}
                    >
                      <div className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 rounded-md bg-stone-200/80" />
                      <div className="absolute left-12 top-1/2 h-2.5 w-28 -translate-y-1/2 rounded-full bg-stone-200/70" />
                    </div>
                  ))}
                  <div className="h-12 rounded-xl bg-stone-200/70 animate-pulse" style={{ animationDelay: "480ms", animationDuration: "1500ms" }} />
                </div>
                <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-bold tracking-wide text-stone-400">
                  <Loader2 size={12} className="animate-spin" />
                  名單完成後即可安全登入
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* ★ 把算好的精準數字傳進去 ★ */}
      <div className={`transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
        <LoginCounter 
          totalUsers={totalActiveUsers}
          brandName={currentBrandConfig?.label}
          status={counterVisualStatus}
          animationKey={currentBrandId}
          onRetry={onRetryAccountDirectory}
        />
      </div>

      <div className={`mt-8 text-center transition-all duration-500 transform ${showBrandSelector ? "opacity-0 scale-95 pointer-events-none absolute" : "opacity-100 scale-100 relative"}`}>
         <p className="text-[10px] text-stone-400 font-medium tracking-widest uppercase flex items-center justify-center gap-1.5">
           DRCYJ Cloud System
           <span className="text-[10px] font-mono bg-stone-200/50 text-stone-400 px-1.5 py-0.5 rounded border border-stone-200/60 shadow-inner select-all tracking-normal lowercase">
             v{appVersion}
           </span>
         </p>
      </div>

      {showBrandSelector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg p-8">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold text-stone-800 mb-2 tracking-tight">歡迎回來</h2>
              <p className="text-stone-400">請選擇要登入的品牌系統</p>
            </div>
            
            <div className="space-y-4">
              {BRANDS.map(brand => {
                let btnIcon = Crown;
                let activeClass = "hover:border-stone-400 hover:bg-stone-50";
                
                if (brand.id === 'anniu') { btnIcon = Heart; activeClass = "hover:border-rose-200 hover:bg-rose-50 hover:text-rose-900"; }
                else if (brand.id === 'yibo') { btnIcon = Sparkles; activeClass = "hover:border-yellow-200 hover:bg-yellow-50 hover:text-yellow-900"; }
                else { activeClass = "hover:border-stone-400 hover:bg-stone-50 hover:text-stone-900"; }

                const Icon = btnIcon;

                return (
                  <button
                    key={brand.id}
                    onClick={() => handleInitialBrandSelect(brand.id)}
                    className={`w-full flex items-center justify-between p-6 rounded-xl border border-stone-200 bg-white transition-all duration-200 group ${activeClass}`}
                  >
                    <div className="flex items-center gap-5">
                      <Icon size={24} strokeWidth={1.5} className="text-stone-400 group-hover:text-current transition-colors"/>
                      <div className="text-left">
                        <h3 className="text-lg font-bold text-stone-700 group-hover:text-current transition-colors">{brand.label}</h3>
                      </div>
                    </div>
                    <ArrowRight size={20} className="text-stone-300 group-hover:text-current transition-colors opacity-0 group-hover:opacity-100 transform group-hover:translate-x-1 duration-300" />
                  </button>
                );
              })}
            </div>
            
            <div className="mt-12 text-center">
              <p className="text-[10px] text-stone-400 font-medium tracking-widest uppercase flex items-center justify-center gap-1.5">
                DRCYJ Cloud System
                <span className="text-[10px] font-mono bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded border border-stone-200 shadow-inner select-all tracking-normal lowercase">
                  v{appVersion}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LoginView;

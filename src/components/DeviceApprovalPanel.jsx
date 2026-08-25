import React, { useEffect, useMemo, useState } from "react";
import { X, ShieldCheck, Smartphone, MapPin, Clock3, KeyRound, CheckCircle2, AlertTriangle, Ban, ArrowLeft, ShieldAlert } from "lucide-react";
import { limit, onSnapshot, query, where } from "firebase/firestore";

const ROLE_LABELS = {
  director: "高階主管",
  trainer: "教專",
  manager: "區長",
  store: "店經理",
  therapist: "管理師",
};

const formatDateTime = (value = "") => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
};

const DeviceApprovalPanel = ({
  open,
  onClose,
  getCollectionPath,
  accountKey,
  currentDeviceId = "",
  currentDeviceTrusted,
  isSuperAdmin,
  onReview,
  embedded = false,
  guided = false,
  guidedRequestId = "",
  onGuidedComplete,
}) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [codes, setCodes] = useState({});
  const [actionKey, setActionKey] = useState("");
  const [message, setMessage] = useState("");
  const [guidedSteps, setGuidedSteps] = useState({});

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setLoadedOnce(false);
    if (guided) {
      setCodes({});
      setGuidedSteps({});
    }
  }, [open, guided, guidedRequestId]);

  useEffect(() => {
    if (!open || !getCollectionPath) return undefined;
    setLoading(true);
    setLoadedOnce(false);
    setMessage("");

    let q;
    // Guided flow 永遠只讀「目前登入者自己的 pending request」。
    // 即使是最高管理者，也不能因為管理權限把其他人的待確認一起塞進主動引導畫面。
    if (guided && accountKey) {
      q = query(
        getCollectionPath("device_approval_requests"),
        where("accountKey", "==", accountKey),
        where("status", "==", "pending"),
        limit(30)
      );
    } else if (isSuperAdmin) {
      q = query(getCollectionPath("device_approval_requests"), where("status", "==", "pending"), limit(50));
    } else if (accountKey) {
      q = query(
        getCollectionPath("device_approval_requests"),
        where("accountKey", "==", accountKey),
        where("status", "==", "pending"),
        limit(30)
      );
    } else {
      setRequests([]);
      setLoading(false);
      setLoadedOnce(true);
      return undefined;
    }

    return onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .filter((row) => row.status === "pending" && Number(row.expiresAtMs || 0) > Date.now())
        .filter((row) => {
          if (!guided) return true;
          if (guidedRequestId && row.id !== guidedRequestId) return false;
          if (row.accountKey !== accountKey) return false;
          if (row.selfApprovalAllowed === false) return false;
          if (currentDeviceId && String(row.deviceId || "") === String(currentDeviceId || "")) return false;
          return true;
        })
        .sort((a, b) => String(a.requestedAtText || "").localeCompare(String(b.requestedAtText || "")));
      setRequests(rows);
      setLoading(false);
      setLoadedOnce(true);
    }, (error) => {
      console.warn("待確認裝置載入失敗:", error);
      setMessage("目前無法載入待確認裝置，請稍後再試。 ");
      setLoading(false);
      setLoadedOnce(true);
    });
  }, [open, getCollectionPath, accountKey, currentDeviceId, isSuperAdmin, guided, guidedRequestId]);

  // Guided request 一旦被核准／否認／過期，Firestore 會把它移出 pending query。
  // 這時自動收起引導頁，回到原本工作畫面；不需要使用者再找關閉按鈕。
  useEffect(() => {
    if (!guided || !open || loading || !loadedOnce || !guidedRequestId) return undefined;
    if (requests.length > 0) return undefined;
    const timer = window.setTimeout(() => onGuidedComplete?.(), 700);
    return () => window.clearTimeout(timer);
  }, [guided, open, loading, loadedOnce, guidedRequestId, requests.length, onGuidedComplete]);

  const title = useMemo(() => {
    if (guided) return "新裝置正在等您確認";
    return isSuperAdmin ? "待確認裝置" : "我的新裝置確認";
  }, [guided, isSuperAdmin]);

  if (!open) return null;

  const setGuidedStep = (requestId, step) => {
    setGuidedSteps((prev) => ({ ...prev, [requestId]: step }));
  };

  const runAction = async (request, action) => {
    const key = `${request.id}_${action}`;
    setActionKey(key);
    setMessage("");
    try {
      const result = await onReview?.({
        request,
        action,
        verificationCode: String(codes[request.id] || "").replace(/\D/g, ""),
      });
      if (!result?.ok) {
        setMessage(result?.message || "目前無法完成確認，請稍後再試。 ");
        return;
      }

      if (action === "approve_self") {
        setMessage(guided ? "新裝置確認完成，正在讓您回到系統。" : "已允許這台裝置使用系統。 ");
      } else if (action === "reject_self") {
        setMessage(guided ? "已阻止這次新裝置登入，並通知最高管理者。您目前的帳號仍可正常使用。" : "已阻止這次新裝置登入，並通知最高管理者。 ");
      } else if (action === "approve_admin") setMessage("已允許這台裝置使用系統。 ");
      else if (action === "observe_admin") setMessage("已保留為觀察裝置，目前不影響使用。 ");
      else if (action === "reverify_admin") setMessage("已標記為需要重新驗證，目前觀察階段不會中斷使用。 ");
      else if (action === "block_admin") setMessage("已禁止這台裝置繼續登入。 ");
      else setMessage("這筆裝置申請已完成處理。 ");
    } catch (error) {
      setMessage("目前無法完成確認，請稍後再試。 ");
    } finally {
      setActionKey("");
    }
  };

  const outerClass = embedded
    ? "w-full"
    : guided
      ? "fixed inset-0 z-[99995] flex items-stretch justify-center bg-stone-900/35 backdrop-blur-md sm:items-center sm:p-5"
      : "fixed inset-0 z-[99990] flex items-start justify-end bg-stone-900/20 backdrop-blur-[2px]";

  const panelClass = embedded
    ? "w-full overflow-hidden rounded-[1.5rem] border border-[#EDE2D4] bg-[#FFFCF8]"
    : guided
      ? "h-full w-full overflow-y-auto bg-[#FFFCF8] shadow-[0_24px_90px_rgba(80,62,45,0.20)] sm:h-auto sm:max-h-[92vh] sm:max-w-[560px] sm:rounded-[2rem] sm:border sm:border-[#EDE2D4]"
      : "h-full w-full max-w-[480px] overflow-y-auto border-l border-[#EDE2D4] bg-[#FFFCF8] shadow-[-18px_0_60px_rgba(80,62,45,0.12)] animate-in slide-in-from-right duration-200";

  const visibleRequests = guided ? requests.slice(0, 1) : requests;

  return (
    <div
      className={outerClass}
      onMouseDown={(event) => {
        if (!embedded && !guided && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={panelClass}>
        <div className="sticky top-0 z-10 border-b border-[#EFE7DA] bg-[#FFFCF8]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-lg font-black text-[#4D4338]"><ShieldCheck size={20} className="text-[#B7863D]" /> {title}</div>
              <p className="mt-1 text-xs font-bold leading-5 text-[#A69C91]">
                {guided
                  ? "先完成這一筆確認，再開始使用系統。您只需要判斷是不是本人正在登入。"
                  : "只顯示目前需要處理的裝置，不會載入完整裝置歷史。"}
              </p>
            </div>
            {!embedded && !guided && <button type="button" onClick={onClose} className="rounded-full p-2 text-[#A69C91] hover:bg-[#F7F1E8] hover:text-[#6E6257]"><X size={20} /></button>}
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {guided && (
            <div className="rounded-[1.4rem] border border-amber-100 bg-gradient-to-br from-[#FFF9EC] via-white to-[#FFF4DC] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#B7863D] shadow-sm"><ShieldAlert size={20} /></div>
                <div>
                  <div className="text-sm font-black text-[#5A4A36]">另一台裝置正在等待您的確認</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-[#8A7355]">如果是您本人正在另一台手機或電腦登入，選「是我本人」後再輸入那台裝置顯示的 6 位數字即可。</p>
                </div>
              </div>
            </div>
          )}

          {message && <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs font-bold leading-5 text-amber-800">{message}</div>}

          {!currentDeviceTrusted && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 text-sm font-bold leading-6 text-rose-700">
              目前這台裝置尚未完成確認。請改用原本已信任的手機或電腦來處理待確認裝置。
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm font-bold text-[#A69C91]">正在整理待確認裝置…</div>
          ) : visibleRequests.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-[#EDE2D4] bg-white/60 px-5 py-14 text-center">
              <CheckCircle2 className="mx-auto text-emerald-500" size={34} />
              <div className="mt-3 text-base font-black text-[#5A5047]">{guided ? "這筆確認已完成" : "目前沒有待確認裝置"}</div>
              <div className="mt-1 text-xs font-bold text-[#A69C91]">{guided ? "正在帶您回到系統…" : "有新裝置申請時，這裡會直接顯示。"}</div>
            </div>
          ) : (
            visibleRequests.map((request) => {
              const isMyRequest = request.accountKey === accountKey;
              // 自己的新裝置，不分角色（包含最高管理者），只要目前操作的是另一台已信任裝置，
              // 就必須走 6 位確認碼；避免最高管理者自己的新裝置繞過驗證碼直接人工核准。
              const canSelfApprove = isMyRequest && currentDeviceTrusted && request.selfApprovalAllowed !== false;
              // 最高管理者人工覆核主要用於「其他人的新裝置」或此申請本身不允許自助確認的救援情境。
              const canAdminReview = isSuperAdmin && currentDeviceTrusted && (!isMyRequest || request.selfApprovalAllowed === false);
              const guidedStep = guidedSteps[request.id] || "decision";

              return (
                <div key={request.id} className={`rounded-[1.4rem] border bg-white p-4 shadow-sm sm:p-5 ${guided ? "border-[#E8D7BF]" : "border-[#EDE2D4]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-[#4D4338]">{guided ? "您要確認的新裝置" : (request.userName || "使用者")}</div>
                      <div className="mt-0.5 text-[11px] font-black text-[#B0A59A]">{ROLE_LABELS[request.role] || request.role || "帳號"}{guided && request.userName ? `・${request.userName}` : ""}</div>
                    </div>
                    <div className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">等待確認</div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 text-xs font-bold text-[#756A60]">
                    <div className="flex items-center gap-2"><Smartphone size={15} className="shrink-0 text-[#B7863D]" /> {request.device || "裝置"} / {request.browser || "瀏覽器"} / {request.os || "-"}</div>
                    <div className="flex items-center gap-2"><MapPin size={15} className="shrink-0 text-[#B7863D]" /> {request.loginLocation?.display || "位置未確認"}</div>
                    <div className="flex items-center gap-2"><Clock3 size={15} className="shrink-0 text-[#B7863D]" /> {formatDateTime(request.requestedAtText)}</div>
                  </div>

                  {request.likelyKnownDevice && (
                    <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs font-bold leading-5 text-sky-700">這台裝置可能曾經使用過，但仍需要重新確認一次。</div>
                  )}

                  {guided && canSelfApprove && guidedStep === "decision" && (
                    <div className="mt-5 rounded-[1.25rem] border border-[#F0E3D1] bg-[#FFFCF8] p-4">
                      <div className="text-center text-base font-black text-[#4D4338]">您剛才是否正在另一台裝置登入系統？</div>
                      <p className="mx-auto mt-2 max-w-sm text-center text-xs font-bold leading-6 text-[#8C8176]">不需要懂任何裝置設定，只要確認這次登入是不是您本人操作即可。</p>
                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => setGuidedStep(request.id, "code")} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-black text-emerald-700 disabled:opacity-40 active:scale-[0.98]">是，我正在登入</button>
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => setGuidedStep(request.id, "reject_confirm")} className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3.5 text-sm font-black text-rose-700 disabled:opacity-40 active:scale-[0.98]">不是我</button>
                      </div>
                    </div>
                  )}

                  {guided && canSelfApprove && guidedStep === "code" && (
                    <div className="mt-5 rounded-[1.25rem] border border-[#F0D8A9] bg-[#FFF9EC] p-4">
                      <button type="button" disabled={Boolean(actionKey)} onClick={() => setGuidedStep(request.id, "decision")} className="mb-3 inline-flex items-center gap-1 text-xs font-black text-[#9A7A4D] disabled:opacity-40"><ArrowLeft size={14} /> 返回上一步</button>
                      <label className="flex items-center justify-center gap-2 text-sm font-black text-[#8A632E]"><KeyRound size={16} /> 輸入新裝置上的 6 位數字</label>
                      <p className="mt-2 text-center text-xs font-bold leading-5 text-[#9A815F]">請看另一台裝置目前顯示的確認碼，再輸入下方欄位。</p>
                      <input
                        autoFocus
                        value={codes[request.id] || ""}
                        onChange={(event) => setCodes((prev) => ({ ...prev, [request.id]: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="例如 583921"
                        className="mt-3 w-full rounded-xl border border-[#E8D7BF] bg-white px-3 py-3 text-center font-mono text-2xl font-black tracking-[0.20em] text-[#5A4225] outline-none focus:border-amber-300"
                      />
                      <button type="button" disabled={String(codes[request.id] || "").length !== 6 || Boolean(actionKey)} onClick={() => runAction(request, "approve_self")} className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-black text-emerald-700 disabled:opacity-40 active:scale-[0.98]">確認這台新裝置</button>
                    </div>
                  )}

                  {guided && canSelfApprove && guidedStep === "reject_confirm" && (
                    <div className="mt-5 rounded-[1.25rem] border border-rose-100 bg-rose-50/70 p-4">
                      <AlertTriangle className="mx-auto text-rose-500" size={26} />
                      <div className="mt-2 text-center text-sm font-black text-rose-700">確定這次登入不是您本人嗎？</div>
                      <p className="mt-2 text-center text-xs font-bold leading-6 text-rose-700/80">確認後會立即阻止這次新裝置登入，並主動通知最高管理者進一步確認；您目前這台原裝置仍可正常使用。</p>
                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => setGuidedStep(request.id, "decision")} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs font-black text-stone-600 disabled:opacity-40">返回</button>
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "reject_self")} className="rounded-xl border border-rose-200 bg-rose-100 px-4 py-3 text-xs font-black text-rose-700 disabled:opacity-40 active:scale-[0.98]">確定不是我，立即阻止</button>
                      </div>
                    </div>
                  )}

                  {!guided && canSelfApprove && (
                    <div className="mt-4 rounded-xl border border-[#F0D8A9] bg-[#FFF9EC] p-3">
                      <label className="flex items-center gap-2 text-xs font-black text-[#8A632E]"><KeyRound size={15} /> 輸入新裝置上的 6 位確認碼</label>
                      <input
                        value={codes[request.id] || ""}
                        onChange={(event) => setCodes((prev) => ({ ...prev, [request.id]: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="例如 583921"
                        className="mt-2 w-full rounded-xl border border-[#E8D7BF] bg-white px-3 py-2.5 text-center font-mono text-lg font-black tracking-[0.16em] text-[#5A4225] outline-none focus:border-amber-300"
                      />
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button type="button" disabled={String(codes[request.id] || "").length !== 6 || Boolean(actionKey)} onClick={() => runAction(request, "approve_self")} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-black text-emerald-700 disabled:opacity-40 active:scale-[0.98]">是我本人，允許使用</button>
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "reject_self")} className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-xs font-black text-rose-700 disabled:opacity-40 active:scale-[0.98]">不是我，立即阻止並通知管理者</button>
                      </div>
                    </div>
                  )}

                  {!guided && canAdminReview && (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "approve_admin")} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left disabled:opacity-40 active:scale-[0.98]">
                        <span className="block text-xs font-black text-emerald-700">允許使用</span>
                        <span className="mt-0.5 block text-[10px] font-bold leading-4 text-emerald-700/70">由最高管理者人工確認後列為信任</span>
                      </button>
                      <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "observe_admin")} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-left disabled:opacity-40 active:scale-[0.98]">
                        <span className="block text-xs font-black text-amber-700">繼續觀察</span>
                        <span className="mt-0.5 block text-[10px] font-bold leading-4 text-amber-700/70">先不列為信任，不影響目前使用</span>
                      </button>
                      <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "reverify_admin")} className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2.5 text-left disabled:opacity-40 active:scale-[0.98]">
                        <span className="flex items-center gap-1 text-xs font-black text-orange-700"><AlertTriangle size={13} /> 要求重新驗證</span>
                        <span className="mt-0.5 block text-[10px] font-bold leading-4 text-orange-700/70">保留高警示；正式啟用驗證後需重新確認</span>
                      </button>
                      <button type="button" disabled={Boolean(actionKey)} onClick={() => runAction(request, "block_admin")} className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-left disabled:opacity-40 active:scale-[0.98]">
                        <span className="flex items-center gap-1 text-xs font-black text-rose-700"><Ban size={13} /> 禁止此裝置</span>
                        <span className="mt-0.5 block text-[10px] font-bold leading-4 text-rose-700/70">停止這台裝置再次登入系統</span>
                      </button>
                    </div>
                  )}

                  {!guided && !isSuperAdmin && isMyRequest && currentDeviceTrusted && request.selfApprovalAllowed === false && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-xs font-bold leading-5 text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> 這筆申請需要由最高管理者協助確認。</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default DeviceApprovalPanel;

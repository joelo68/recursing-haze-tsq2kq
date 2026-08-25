import React, { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, Smartphone, Clock3, KeyRound, ArrowLeft, LifeBuoy, CheckCircle2, AlertTriangle } from "lucide-react";
import { onSnapshot } from "firebase/firestore";

const formatCode = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
};

const formatRemaining = (remainingMs = 0) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
};

const DeviceApprovalGate = ({
  approval,
  requestRef,
  onApproved,
  onCancel,
  onEmergencyRecovery,
}) => {
  const [requestStatus, setRequestStatus] = useState("pending");
  const [resolvedSource, setResolvedSource] = useState("");
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, Number(approval?.expiresAtMs || 0) - Date.now()));
  const [showRecovery, setShowRecovery] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const approvedHandledRef = useRef(false);
  const requiresManagerHelp = approval?.adminOnly === true || approval?.selfApprovalAllowed === false;
  const hasTrustedApproverDevice = approval?.hasTrustedApproverDevice !== false;
  const managerHelpReason = approval?.deviceStatus === "suspicious"
    ? "這次登入需要再確認，為了保護帳號安全，請由最高管理者協助處理。"
    : !hasTrustedApproverDevice
      ? "目前這個帳號沒有其他可用的已信任裝置，請由最高管理者協助完成第一次確認。"
      : "為了保護帳號安全，這次不開放自行確認。請聯繫最高管理者協助處理。";

  useEffect(() => {
    if (!requestRef) return undefined;
    return onSnapshot(requestRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const nextStatus = String(data.status || "pending");
      const nextResolvedSource = String(data.resolvedSource || "");
      setRequestStatus(nextStatus);
      setResolvedSource(nextResolvedSource);
      if (nextStatus === "approved" && nextResolvedSource !== "emergency_master_unblocked" && !approvedHandledRef.current) {
        approvedHandledRef.current = true;
        onApproved?.();
      }
    }, (error) => {
      console.warn("新裝置確認狀態同步失敗:", error);
    });
  }, [requestRef, onApproved]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, Number(approval?.expiresAtMs || 0) - Date.now()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [approval?.expiresAtMs]);

  const isExpired = remainingMs <= 0 && requestStatus === "pending";
  const statusContent = useMemo(() => {
    if (requestStatus === "approved" && resolvedSource === "emergency_master_unblocked") return { title: "這台裝置已恢復使用", text: "請返回登入頁重新登入，系統不會從救援畫面直接進入。", tone: "emerald", needsReturn: true };
    if (requestStatus === "approved") return { title: "已完成確認", text: "正在為您進入系統…", tone: "emerald" };
    if (requestStatus === "rejected") return { title: "這次申請未通過", text: "如仍需要使用這台裝置，請聯繫最高管理者協助確認。", tone: "rose" };
    if (requestStatus === "expired" || isExpired) return { title: "確認時間已過", text: "為了保護帳號安全，請返回登入頁重新申請。", tone: "amber" };
    return null;
  }, [requestStatus, resolvedSource, isExpired]);

  const handleRecovery = async () => {
    const password = String(masterPassword || "").trim();
    if (!password || recovering) return;
    setRecovering(true);
    setRecoveryMessage("");
    try {
      const result = await onEmergencyRecovery?.(password);
      if (result?.ok) {
        setRecoveryMessage("已完成協助設定，請重新登入。 ");
        setMasterPassword("");
      } else {
        setRecoveryMessage(result?.message || "目前無法完成協助，請確認後再試一次。 ");
      }
    } catch (error) {
      setRecoveryMessage("目前無法完成協助，請稍後再試一次。 ");
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#FBF7F1_0%,#FFFDFC_50%,#F8F1E8_100%)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[520px] rounded-[2rem] border border-[#EDE2D4] bg-white/95 p-6 md:p-8 shadow-[0_24px_80px_rgba(110,86,60,0.12)] backdrop-blur">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-amber-100 bg-amber-50 text-amber-700 shadow-sm">
          <ShieldCheck size={30} strokeWidth={2.1} />
        </div>

        <div className="mt-5 text-center">
          <p className="text-[11px] font-black tracking-[0.22em] text-[#B7863D]">帳號安全確認</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-[#3F372F]">這台裝置需要先確認</h1>
          <p className="mx-auto mt-3 max-w-md text-sm font-bold leading-7 text-[#8C8176]">
            {requiresManagerHelp
              ? "為了保護帳號與營運資料，這次需要完成安全確認後才能繼續使用。"
              : "為了保護帳號與營運資料，請使用您原本已信任的手機或電腦完成確認。"}
          </p>
        </div>

        {statusContent ? (
          <div className={`mt-6 rounded-2xl border p-5 text-center ${statusContent.tone === "emerald" ? "border-emerald-100 bg-emerald-50/70" : statusContent.tone === "rose" ? "border-rose-100 bg-rose-50/70" : "border-amber-100 bg-amber-50/70"}`}>
            {requestStatus === "approved" ? <CheckCircle2 className="mx-auto text-emerald-600" size={28} /> : <AlertTriangle className="mx-auto text-amber-600" size={28} />}
            <div className="mt-2 text-base font-black text-[#4D4338]">{statusContent.title}</div>
            <div className="mt-1 text-sm font-bold leading-6 text-[#8C8176]">{statusContent.text}</div>
            {(requestStatus !== "approved" || statusContent.needsReturn) && (
              <button type="button" onClick={onCancel} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#E8D7BF] bg-[#FFF9F0] px-4 py-2.5 text-sm font-black text-[#8A632E] hover:bg-[#FFF3DF] active:scale-[0.98]">
                <ArrowLeft size={16} /> 返回登入
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-[#EFE7DA] bg-[#FFFCF7] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 border border-[#F1E9DF]">
                  <Smartphone size={18} className="text-[#B7863D] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-black text-[#B0A59A]">目前裝置</div>
                    <div className="truncate text-sm font-black text-[#5A5047]">{approval?.deviceInfo?.device || "裝置"} / {approval?.deviceInfo?.browser || "瀏覽器"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-white px-3 py-3 border border-[#F1E9DF]">
                  <Clock3 size={18} className="text-[#B7863D] shrink-0" />
                  <div>
                    <div className="text-[11px] font-black text-[#B0A59A]">確認時間</div>
                    <div className="text-sm font-black text-[#5A5047]">剩餘 {formatRemaining(remainingMs)}</div>
                  </div>
                </div>
              </div>

              {approval?.likelyKnownDevice && (
                <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2.5 text-xs font-bold leading-5 text-sky-700">
                  這台裝置看起來可能曾經使用過，但為了安全仍需要重新確認一次。
                </div>
              )}
            </div>

            {requiresManagerHelp ? (
              <div className="mt-5 rounded-[1.5rem] border border-rose-100 bg-rose-50/60 p-5 text-center">
                <AlertTriangle className="mx-auto text-rose-500" size={26} />
                <div className="mt-2 text-sm font-black text-rose-700">這台裝置需要由最高管理者協助確認</div>
                <p className="mt-2 text-xs font-bold leading-6 text-rose-700/75">
                  {managerHelpReason}
                </p>
              </div>
            ) : (
              <div className="mt-5 rounded-[1.5rem] border border-[#F0D8A9] bg-[linear-gradient(135deg,#FFF9EC_0%,#FFF3D8_100%)] p-5 text-center">
                <div className="flex items-center justify-center gap-2 text-xs font-black text-[#A87A37]">
                  <KeyRound size={16} /> 新裝置確認碼
                </div>
                <div className="mt-3 select-all font-mono text-4xl font-black tracking-[0.18em] text-[#5A4225]">
                  {formatCode(approval?.verificationCode || "")}
                </div>
                <p className="mt-3 text-xs font-bold leading-6 text-[#8A7355]">
                  請在原本已信任的裝置開啟系統，點右上角「待確認」，再輸入這組 6 位數確認碼。
                </p>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-[#EFE7DA] bg-[#FAF7F2] p-4 text-xs font-bold leading-6 text-[#7C7063]">
              <div className="font-black text-[#5F544A]">沒有可使用的舊裝置？</div>
              <div className="mt-1">可請最高管理者從系統內協助確認；若遇到緊急狀況，也可使用下方的管理者協助功能。</div>
            </div>

            <div className="mt-4">
              <button type="button" onClick={() => setShowRecovery((value) => !value)} className="w-full rounded-xl border border-[#E8DDD0] bg-white px-4 py-3 text-sm font-black text-[#7C6855] hover:bg-[#FAF7F2] active:scale-[0.99] flex items-center justify-center gap-2">
                <LifeBuoy size={17} /> 最高管理者協助
              </button>
              {showRecovery && (
                <div className="mt-3 rounded-2xl border border-[#EFE7DA] bg-white p-4">
                  <p className="text-xs font-bold leading-6 text-[#8C8176]">
                    僅供本人無法使用任何已信任裝置時使用。完成後仍需重新登入，不會直接進入系統。
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      value={masterPassword}
                      onChange={(event) => setMasterPassword(event.target.value)}
                      placeholder="輸入最高管理者密碼"
                      className="min-w-0 flex-1 rounded-xl border border-[#E8DDD0] bg-[#FFFCF7] px-3 py-2.5 text-sm font-bold text-[#5A5047] outline-none focus:border-amber-300"
                    />
                    <button type="button" disabled={!masterPassword.trim() || recovering} onClick={handleRecovery} className="rounded-xl border border-[#E8C77A] bg-gradient-to-r from-[#FFF4D8] to-[#EFD399] px-4 py-2.5 text-sm font-black text-[#6A4D26] disabled:opacity-50 active:scale-[0.98]">
                      {recovering ? "處理中…" : "協助恢復"}
                    </button>
                  </div>
                  {recoveryMessage && <div className="mt-2 text-xs font-bold text-[#A66F55]">{recoveryMessage}</div>}
                </div>
              )}
            </div>

            <button type="button" onClick={onCancel} className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-black text-[#9B8E81] hover:bg-[#FAF7F2] active:scale-[0.99] flex items-center justify-center gap-2">
              <ArrowLeft size={16} /> 返回登入
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default DeviceApprovalGate;

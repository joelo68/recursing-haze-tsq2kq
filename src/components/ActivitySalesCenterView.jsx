import React, { useEffect, useMemo, useState } from "react";
import ActivitySalesManagementView from "./ActivitySalesManagementView";
import { collection, getDocsFromServer, limit, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "../config/firebase";
import {
  calculateActivityPackage, getActivitySalesPublicationPath, listPublishedCampaigns,
  searchPublishedCampaigns, taipeiDateString,
} from "../utils/activitySalesPublished";

// Local Emulator Phase 1B frontend preview only; not a Production navigation item.
const money = (value) => new Intl.NumberFormat("zh-TW", {
  style: "currency", currency: "TWD", maximumFractionDigits: 0,
}).format(value);
const names = { cyj: "CYJ", anniu: "安妞", yibo: "伊啵" };
const ListLines = ({ title, values }) => (
  Array.isArray(values) && values.length > 0 ? (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-black text-stone-700">{title}</h3>
      <ul className="space-y-1 text-xs font-medium leading-6 text-stone-600">
        {values.map((value, index) => <li key={`${index}-${value}`} className="rounded-lg bg-stone-50 px-3 py-1">{value}</li>)}
      </ul>
    </section>
  ) : null
);

export default function ActivitySalesCenterView({ brandId, deviceId }) {
  const [workspaceTab,setWorkspaceTab]=useState("published");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const today = taipeiDateString();

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setSelectedId("");
    setError("");
    setLoading(true);
    async function load() {
      try {
        if (!auth.currentUser) throw new Error("請先完成正式 Application Identity 登入");
        // One scoped, server-authoritative query per entry/manual refresh; no listener/polling.
        const ref = collection(db, getActivitySalesPublicationPath(brandId));
        const snap = await getDocsFromServer(query(ref,
          where("endDate", ">=", today), orderBy("endDate", "asc"), limit(30)));
        const rows = listPublishedCampaigns(snap.docs.map((docSnap) => ({ ...docSnap.data(), campaignId: docSnap.id })), today);
        if (!cancelled) setItems(rows);
      } catch (err) {
        if (!cancelled) setError(err?.code === "permission-denied"
          ? "無法確認此品牌的正式登入權限，已停止載入活動。"
          : String(err?.message || "目前無法確認正式已發布活動"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [brandId, refresh, today]);

  const filtered = useMemo(() => searchPublishedCampaigns(items, search), [items, search]);
  const selected = filtered.find((item) => item.campaignId === selectedId) || filtered[0] || null;
  const pkg = selected?.packages?.find((p) => p.packageId === packageId) || selected?.packages?.[0] || null;
  let calculation = null;
  let calculationError = "";
  if (pkg) {
    try { calculation = calculateActivityPackage(pkg, quantity); }
    catch (err) { calculationError = err?.message || "試算資料錯誤"; }
  }

  return (
    <div className="mx-auto w-full max-w-7xl pb-24 text-stone-700">
      <div className="mb-4 flex gap-2 border-b border-rose-100 pb-3">
        <button type="button" className={`rounded-full px-4 py-2 text-xs font-bold ${workspaceTab==="published" ? "bg-rose-500 text-white" : "border border-stone-200 bg-white text-stone-600"}`} onClick={()=>setWorkspaceTab("published")}>第一線正式活動</button>
        <button type="button" className={`rounded-full px-4 py-2 text-xs font-bold ${workspaceTab==="management" ? "bg-rose-500 text-white" : "border border-stone-200 bg-white text-stone-600"}`} onClick={()=>setWorkspaceTab("management")}>管理端 · 建立／審核</button>
      </div>
      {workspaceTab==="management" ? <ActivitySalesManagementView brandId={brandId} deviceId={deviceId} /> : (<>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-black tracking-[.18em] text-rose-500">LOCAL EMULATOR · PHASE 1B</span>
          <h2 className="mt-1 text-xl font-black text-stone-800">活動銷售中心 <span className="text-sm font-semibold text-stone-400">{names[brandId] || ""}</span></h2>
          <p className="mt-1 text-xs text-stone-500">僅顯示已正式發布的活動方案；套組試算為銷售參考，不會新增日報營收。</p>
        </div>
        <button type="button" onClick={() => setRefresh((prev) => prev + 1)}
          className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-bold hover:bg-rose-50">
          重新確認活動
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <label htmlFor="activity-sales-search" className="text-xs font-black">搜尋活動 / 套組</label>
          <input id="activity-sales-search" type="search" value={search} onChange={(e) => {setSearch(e.target.value);setSelectedId("");}}
            placeholder="活動名稱、重點、關鍵字" className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm outline-none focus:border-rose-300" />
          <div className="mt-3 text-[11px] font-bold text-stone-400">顯示 {filtered.length} 檔 · 單次最多讀取 30 筆</div>
          {loading && <p role="status" className="mt-4 text-xs text-stone-500">正在確認發布資料…</p>}
          {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
          {!loading && !error && filtered.length === 0 && <p className="mt-5 text-xs text-stone-500">目前沒有符合條件的已發布活動。</p>}
          <div className="mt-3 space-y-2">
            {filtered.map((item) => (
              <button type="button" key={`${item.campaignId}-${item.versionId}`} onClick={() => {setSelectedId(item.campaignId);setPackageId("");setQuantity(1);}}
                className={`w-full rounded-xl border px-3 py-3 text-left ${selected?.campaignId === item.campaignId ? "border-rose-300 bg-rose-50" : "border-stone-100 bg-stone-50 hover:border-rose-200"}`}>
                <div className="text-xs font-black text-stone-800">{item.title}</div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-stone-500">{item.shortSummary || "查看活動正式內容"}</p>
                <div className="mt-1 text-[10px] font-semibold text-stone-400">{item.startDate} ～ {item.endDate} {item.startDate > today ? "· 即將開始" : "· 進行中"}</div>
              </button>
            ))}
          </div>
        </aside>
        <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          {!selected ? <p className="py-20 text-center text-xs text-stone-400">選取一檔已發布活動查看正式方案。</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-rose-600">
                <span className="rounded-full bg-rose-50 px-2.5 py-1">已發布 · v{selected.versionId?.split("_v").pop() || "-"}</span>
                <span>{selected.startDate} ～ {selected.endDate}</span>
              </div>
              <h3 className="mt-3 text-lg font-black text-stone-800">{selected.title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{selected.shortSummary || "以下為正式活動內容"}</p>
              <ListLines title="30 秒銷售重點" values={selected.sellingPoints} />
              <ListLines title="適用對象" values={selected.suitableFor} />
              <ListLines title="不適用 / 注意" values={selected.notSuitableFor} />
              {selected.storeScope === "selected" && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">限定門市：{(selected.stores || []).join("、")}</p>}
              <div className="mt-6 border-t border-stone-100 pt-5">
                <h4 className="text-sm font-black">正式套組與快速試算</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(selected.packages || []).map((p) => <button key={p.packageId} type="button" onClick={() => {setPackageId(p.packageId);setQuantity(1);}}
                    className={`rounded-xl border p-3 text-left text-xs ${p.packageId === pkg?.packageId ? "border-rose-300 bg-rose-50" : "border-stone-200 bg-white"}`}>
                    <div className="font-black">{p.name}</div><div className="mt-2 font-bold text-rose-700">{money(p.salePrice)}</div>
                  </button>)}
                </div>
                {pkg && <div className="mt-3 rounded-xl bg-stone-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="text-xs font-bold">套組數量 <input type="number" min="1" max="99" step="1" value={quantity}
                      onChange={(e) => setQuantity(e.target.value)} className="ml-2 w-20 rounded-lg border border-stone-200 bg-white px-2 py-1 text-center" /></label>
                    <div className="text-right"><div className="text-[10px] text-stone-500">顧客應付金額</div><div className="text-xl font-black text-rose-700">{calculation ? money(calculation.total) : "—"}</div></div>
                  </div>
                  {calculationError && <p role="alert" className="mt-2 text-xs text-rose-700">試算失敗：{calculationError}</p>}
                  {calculation && <div className="mt-3 border-t border-stone-200 pt-3 text-xs text-stone-600">
                    <p className="mb-2 font-black">內部金額歸屬（已包含於應付金額，不可再加算）</p>
                    {calculation.lines.map((line, index) => <div key={`${line.itemId}-${index}`} className="flex justify-between gap-3 py-1"><span>{line.name} × {line.quantity * calculation.quantity}</span><span>{money(line.totalAttributedAmount)}</span></div>)}
                    <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 font-black"><span>歸屬合計</span><span>{money(calculation.attributionTotal)}</span></div>
                  </div>}
                </div>}
              </div>
              <ListLines title="正式優惠規則" values={selected.discountRules} />
              <ListLines title="限制與不可併用條件" values={selected.restrictions} />
              {selected.salesTalk && <section className="mt-5"><h4 className="text-xs font-black">建議話術</h4><p className="mt-2 whitespace-pre-wrap rounded-xl bg-stone-50 p-3 text-xs leading-6">{selected.salesTalk}</p></section>}
              {!!selected.faq?.length && <section className="mt-5"><h4 className="text-xs font-black">常見問題</h4>{selected.faq.map((f) => <details key={f.faqId} className="mt-2 rounded-xl border border-stone-200 px-3 py-2 text-xs"><summary className="cursor-pointer font-bold">{f.question}</summary><p className="mt-2 whitespace-pre-wrap leading-6 text-stone-600">{f.answer}</p></details>)}</section>}
            </>
          )}
        </section>
      </div>
      </>)}
    </div>
  );
}

import React, { useState } from "react";

const textBox = "min-w-0 w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700 outline-none focus:border-rose-300";
const buttonStyle = "rounded-full border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40";
const emptyAccount = () => ({ roleId: "", accountId: "", name: "" });
const emptySelector = () => ({ type: "account", account: emptyAccount() });
const emptyPolicy = () => ({ revision: 0, groups: {}, creatorSelectors: [], directPublishSelectors: [], publisherSelectors: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));

function AccountFields({ account, onChange }) {
  return <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
    <input className={textBox} placeholder="角色代碼 roleId" aria-label="角色代碼" value={account.roleId || ""} onChange={(e)=>onChange({ ...account, roleId:e.target.value })}/>
    <input className={textBox} placeholder="帳號代碼 accountId" aria-label="帳號代碼" value={account.accountId || ""} onChange={(e)=>onChange({ ...account, accountId:e.target.value })}/>
    <input className={textBox} placeholder="顯示名稱" aria-label="顯示名稱" value={account.name || ""} onChange={(e)=>onChange({ ...account, name:e.target.value })}/>
  </div>;
}

function SelectorEditor({ title, value, onChange, groups }) {
  const list=Array.isArray(value)?value:[];
  const update=(i, next)=>onChange(list.map((v,j)=>j===i?next:v));
  return <div className="rounded-xl border border-stone-200 p-3">
    <div className="flex items-center justify-between gap-2"><strong className="text-xs">{title}</strong><button type="button" className={buttonStyle} onClick={()=>onChange([...list,emptySelector()])}>＋加入人員／群組</button></div>
    <div className="mt-2 space-y-2">{list.length===0 && <p className="text-[11px] text-stone-400">尚未授權任何人員</p>}
      {list.map((item,i)=><div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-2">
        <select className={`${textBox} w-auto`} aria-label="指定方式" value={item.type} onChange={(e)=>update(i,e.target.value==="group"?{type:"group",groupId:""}:emptySelector())}>
          <option value="account">指定人員</option><option value="group">指定群組</option>
        </select>
        {item.type==="group" ? <select className={`${textBox} flex-1`} aria-label="權限群組" value={item.groupId || ""} onChange={(e)=>update(i,{...item,groupId:e.target.value})}>
          <option value="">選擇群組</option>{Object.keys(groups || {}).map((id)=><option key={id} value={id}>{groups[id]?.label || id}（{id}）</option>)}
        </select> : <AccountFields account={item.account || emptyAccount()} onChange={(account)=>update(i,{type:"account",account})}/>}
        <button type="button" className={buttonStyle} onClick={()=>onChange(list.filter((_,j)=>j!==i))}>移除</button>
      </div>)}</div>
  </div>;
}

function GroupsEditor({ groups, onChange }) {
  const entries=Object.entries(groups || {});
  const updateGroup=(oldId,newId,value)=>{
    const next={};
    for (const [id,group] of entries) next[id===oldId?newId:id]=id===oldId?value:group;
    onChange(next);
  };
  return <div className="rounded-xl border border-stone-200 p-3">
    <div className="flex items-center justify-between gap-2"><strong className="text-xs">人員群組</strong><button type="button" className={buttonStyle} onClick={()=>{
      let i=1;while(groups[`group_${i}`]) i+=1;
      onChange({...groups,[`group_${i}`]:{groupId:`group_${i}`,label:`群組 ${i}`,members:[emptyAccount()]}});
    }}>＋新增群組</button></div>
    <p className="mt-2 text-[11px] text-stone-500">指定「角色代碼＋實際帳號 ID」，不是僅指定職稱。變更群組代碼後，也要同步調整使用該群組的授權設定。</p>
    {entries.map(([id,group])=><div key={id} className="mt-3 space-y-2 rounded-xl bg-stone-50 p-3">
      <div className="flex flex-wrap gap-2">
        <input aria-label="群組代碼" className={`${textBox} flex-1`} value={id} onChange={(e)=>updateGroup(id,e.target.value,{...group,groupId:e.target.value})}/>
        <input aria-label="群組名稱" className={`${textBox} flex-1`} value={group.label || ""} onChange={(e)=>updateGroup(id,id,{...group,label:e.target.value})}/>
        <button type="button" className={buttonStyle} onClick={()=>onChange(Object.fromEntries(entries.filter(([key])=>key!==id)))}>刪除群組</button>
      </div>
      {(group.members || []).map((account,index)=><div key={index} className="flex flex-wrap gap-2">
        <AccountFields account={account} onChange={(next)=>updateGroup(id,id,{...group,members:group.members.map((old,j)=>j===index?next:old)})}/>
        <button type="button" className={buttonStyle} onClick={()=>updateGroup(id,id,{...group,members:group.members.filter((_,j)=>j!==index)})}>移除</button>
      </div>)}
      <button type="button" className={buttonStyle} onClick={()=>updateGroup(id,id,{...group,members:[...(group.members || []),emptyAccount()]})}>＋新增成員</button>
    </div>)}
  </div>;
}

function validatePolicyDraft(raw) {
  const result=clone(raw);
  const ids=Object.keys(result.groups || {});
  for (const id of ids) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error(`群組代碼 ${id} 只能使用英數、底線與連字號`);
    const group=result.groups[id];
    if (!group.members?.length) throw new Error(`群組 ${id} 至少需要一名有效成員`);
    group.groupId=id;
    for (const account of group.members) if (!account.roleId?.trim() || !account.accountId?.trim()) throw new Error(`群組 ${id} 存在未填完整的帳號`);
  }
  for (const field of ["creatorSelectors","directPublishSelectors","publisherSelectors"]) {
    for (const selector of result[field] || []) {
      if (selector.type==="group" && !ids.includes(selector.groupId)) throw new Error(`授權清單 ${field} 使用了不存在的群組`);
      if (selector.type==="account" && (!selector.account?.roleId?.trim() || !selector.account?.accountId?.trim())) throw new Error(`授權清單 ${field} 存在未填完整的帳號`);
    }
  }
  return result;
}

export default function ActivitySalesPolicyPanel({ request, busy, setBusy }) {
  const [policy,setPolicy]=useState(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [dirty,setDirty]=useState(false);
  const edit=(mutate)=>{setPolicy((prev)=>mutate(prev));setDirty(true);};
  async function execute(task) {
    if (busy) return;
    setBusy(true);setError("");setMessage("");
    try {await task();} catch (err) {setError(`${err.message || "操作失敗"}${err.code==="POLICY_CONFLICT"?"；其他最高管理者已更新，請重新讀取再編輯。":""}`);}
    finally {setBusy(false);}
  }
  const load=()=>execute(async()=>{
    if (dirty && !window.confirm("尚有未儲存的權限設定；確定捨棄並重新讀取？")) return;
    const result=await request("https://us-central1-cyjsituation-analysis.cloudfunctions.net/getActivitySalesWorkspace","get_policy");
    setPolicy(clone(result.policy || emptyPolicy()));setDirty(false);
    setMessage(result.policyReady?`已讀取目前 Revision ${result.policy?.revision || 0}`:"目前尚未建立 Policy（預設 Revision 0）");
  });
  const save=()=>execute(async()=>{
    if (!policy) throw new Error("請先讀取權限設定");
    const next=validatePolicyDraft(policy);
    if (!window.confirm("確定要更新這個品牌的活動權限？修改會立即影響建立與發布授權；既有審核快照不會因此重寫。")) return;
    const result=await request("https://us-central1-cyjsituation-analysis.cloudfunctions.net/manageActivitySalesPolicy","update_policy",{
      expectedRevision:policy.revision,policy:next,
    });
    setPolicy(clone(result.policy));setDirty(false);
    setMessage(`權限已儲存，Revision ${result.policy.revision}`);
  });
  return <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonStyle} disabled={busy} onClick={load}>重新驗證並讀取 Policy</button>
      <span className="text-xs text-stone-500">{policy?`Revision ${policy.revision}`:"尚未讀取"}{dirty?" · 有未儲存修改":""}</span>
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
    {policy && <div className="space-y-3">
      <GroupsEditor groups={policy.groups} onChange={(groups)=>edit((prev)=>({...prev,groups}))}/>
      <SelectorEditor title="可以建立活動的人員／群組" value={policy.creatorSelectors} groups={policy.groups} onChange={(creatorSelectors)=>edit((prev)=>({...prev,creatorSelectors}))}/>
      <SelectorEditor title="可以免審核直接發布的人員／群組" value={policy.directPublishSelectors} groups={policy.groups} onChange={(directPublishSelectors)=>edit((prev)=>({...prev,directPublishSelectors}))}/>
      <SelectorEditor title="可以發布核准版本的人員／群組" value={policy.publisherSelectors} groups={policy.groups} onChange={(publisherSelectors)=>edit((prev)=>({...prev,publisherSelectors}))}/>
      <div className="flex flex-wrap gap-3 items-center"><button type="button" className="rounded-full bg-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-40" disabled={busy || !dirty} onClick={save}>儲存品牌權限（OCC）</button><p className="text-[11px] text-amber-800">同時管理時如 Revision 衝突，後端會拒絕覆寫。</p></div>
    </div>}
  </div>;
}

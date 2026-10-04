import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
} from 'lucide-react';

const toneClasses = {
  positive: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
  neutral: 'border-stone-200 bg-white/80 text-stone-600',
  warning: 'border-amber-200 bg-amber-50/75 text-amber-800',
  attention: 'border-orange-200 bg-orange-50/70 text-orange-800',
  critical: 'border-rose-200 bg-rose-50/75 text-rose-700',
};

const actionAccent = {
  reporting: 'border-l-amber-400',
  target: 'border-l-orange-300',
  performance: 'border-l-[#C7904B]',
  security: 'border-l-rose-400',
};

const ActionIcon = ({ kind }) => {
  if (kind === 'security') return <ShieldCheck size={19} />;
  if (kind === 'reporting') return <ClipboardCheck size={19} />;
  if (kind === 'target') return <Target size={19} />;
  if (kind === 'performance') return <TrendingDown size={19} />;
  return <AlertTriangle size={19} />;
};

const ActionCenter = ({
  state,
  onOpenAudit,
  onOpenSecurity,
  onOpenStore,
}) => {
  if (!state?.visible) return null;

  const handleAction = (action) => {
    if (action?.ctaType === 'audit') onOpenAudit?.();
    if (action?.ctaType === 'security') onOpenSecurity?.();
    if (action?.ctaType === 'store' && action?.storeName) onOpenStore?.(action.storeName);
  };

  const actionCount = Number(state.totalActionCount || 0);
  return (
    <section
      className="rounded-[1.75rem] border border-[#E9DED1] bg-gradient-to-br from-[#FFFCF8] via-white to-[#FBF7F1] p-4 shadow-[0_12px_36px_rgba(104,82,57,0.07)] sm:p-5"
      data-action-center="v1"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#6B5B4D]">
            <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[#F7EBDD] text-[#B87936]">
              <Sparkles size={17} />
            </span>
            <div>
              <h2 className="text-base font-black tracking-tight text-[#4F463E] sm:text-lg">今日行動中心</h2>
              <p className="mt-0.5 text-[11px] font-bold text-[#A29588] sm:text-xs">
                {state.brandName || '目前品牌'}{state.scopeStoreCount > 0 ? `｜目前範圍 ${state.scopeStoreCount} 家店` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${
          actionCount > 0
            ? 'border-[#E7C99F] bg-[#FFF8EE] text-[#8C6437]'
            : 'border-emerald-100 bg-emerald-50/80 text-emerald-700'
        }`}>
          {actionCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {actionCount > 0 ? `今天有 ${actionCount} 件事值得注意` : '今天沒有需要立即處理的事項'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(state.summary || []).map((item) => (
          <div
            key={item.key}
            className={`min-w-0 rounded-2xl border px-3 py-2.5 ${toneClasses[item.tone] || toneClasses.neutral}`}
            title={item.hint || ''}
          >
            <div className="text-[10px] font-black tracking-wide opacity-65">{item.label}</div>
            <div className="mt-1 truncate text-sm font-black">{item.value}</div>
          </div>
        ))}
      </div>

      {state.actions?.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {state.actions.map((action, index) => (
            <article
              key={action.id}
              className={`flex min-h-[178px] flex-col rounded-2xl border border-[#EEE4DA] border-l-4 bg-white/90 p-4 shadow-sm ${actionAccent[action.kind] || 'border-l-stone-300'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${toneClasses[action.tone] || toneClasses.neutral}`}>
                  <ActionIcon kind={action.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black tracking-widest text-[#B1A69A]">優先事項 {index + 1}</div>
                  <h3 className="mt-1 text-sm font-black leading-5 text-[#4F463E]">{action.title}</h3>
                </div>
              </div>

              <p className="mt-3 text-xs font-bold leading-5 text-[#776C62]">{action.detail}</p>
              {action.impact && (
                <p className="mt-2 text-[11px] font-bold leading-5 text-[#A0774D]">{action.impact}</p>
              )}

              <div className="mt-auto pt-3">
                {action.ctaType ? (
                  <button
                    type="button"
                    onClick={() => handleAction(action)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#E6D7C5] bg-[#FFF9F1] px-3 py-1.5 text-[11px] font-black text-[#7C6248] transition hover:bg-[#FFF3E2] active:scale-[0.98]"
                  >
                    {action.ctaLabel || '查看'}
                    <ChevronRight size={13} />
                  </button>
                ) : (
                  <span className="text-[10px] font-bold text-[#B1A69A]">請依既有權限流程處理</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/55 px-4 py-3 text-xs font-bold text-emerald-700">
          <CheckCircle2 size={17} />
          目前沒有需要主管立即介入的營運事件；一般進度仍可在下方 Dashboard 持續查看。
        </div>
      )}

      {state.hiddenActionCount > 0 && (
        <div className="mt-3 text-right text-[10px] font-bold text-[#A99D91]">
          另有 {state.hiddenActionCount} 項低優先事件，本版先維持 Top 3，避免首頁資訊過載。
        </div>
      )}
    </section>
  );
};

export default ActionCenter;

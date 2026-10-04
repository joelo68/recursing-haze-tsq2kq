import {
  isLifecycleEntryExpectedForDate,
  normalizeStoreLifecycleCore,
} from './storeLifecycle.js';
import {
  formatCalendarDate,
  getDailyAuditPolicy,
  getTaipeiDateTimeParts,
} from './dailyAuditPolicy.js';

export const ACTION_CENTER_VERSION = 'action-center-v1';
export const ACTION_CENTER_MAX_ACTIONS = 3;
export const ACTION_CENTER_PERFORMANCE_THRESHOLD_PERCENT = 90;
export const ACTION_CENTER_EARLY_MONTH_DAYS = 5;

const normalizeStoreKey = (value = '') => normalizeStoreLifecycleCore(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const normalizeReportDate = (value) => {
  if (!value) return '';

  let dateValue = value;
  if (typeof value?.toDate === 'function') {
    try {
      dateValue = value.toDate();
    } catch (error) {
      return '';
    }
  }

  if (dateValue instanceof Date && Number.isFinite(dateValue.getTime())) {
    const parts = getTaipeiDateTimeParts(dateValue);
    return formatCalendarDate(parts.year, parts.month, parts.day);
  }

  if (typeof dateValue === 'string') {
    const match = dateValue.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      return formatCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  return '';
};

const formatMoneyShort = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const absolute = Math.abs(numeric);
  if (absolute >= 10_000) {
    const tenThousands = Math.round(absolute / 10_000);
    return `${numeric < 0 ? '-' : ''}${tenThousands.toLocaleString('zh-TW')} 萬`;
  }
  return `${numeric < 0 ? '-' : ''}${Math.round(absolute).toLocaleString('zh-TW')}`;
};

const getVisibleAuthorityRows = ({ formalAuthority, visibleStoreKeys }) => {
  if (!formalAuthority?.compatible || formalAuthority?.lifecycleReady !== true) return [];
  const visibleSet = new Set((visibleStoreKeys || []).map(normalizeStoreKey).filter(Boolean));
  return Object.values(formalAuthority?.stores || {}).filter((row) => {
    const key = normalizeStoreKey(row?.storeKey || row?.canonicalStoreName || '');
    if (!key) return false;
    return visibleSet.has(key);
  });
};

const buildReportingState = ({
  policy,
  authorityRows,
  reports,
}) => {
  const formalReady = Array.isArray(authorityRows);
  if (!formalReady) {
    return {
      ready: false,
      chip: { key: 'reporting', label: '今日回報', value: '資料整理中', tone: 'neutral', hint: '正在確認今日應回報範圍。' },
      action: null,
      missingStoreKeys: [],
      expectedStoreCount: 0,
      reportedStoreCount: 0,
    };
  }

  const expectedRows = authorityRows.filter((row) => (
    row?.lifecycleEntry
    && isLifecycleEntryExpectedForDate(row.lifecycleEntry, policy.todayDate)
  ));
  const expectedStoreMap = new Map(expectedRows.map((row) => [
    normalizeStoreKey(row?.storeKey || row?.canonicalStoreName || ''),
    row,
  ]).filter(([key]) => Boolean(key)));

  const reportedStoreKeys = new Set();
  (Array.isArray(reports) ? reports : []).forEach((report) => {
    if (normalizeReportDate(report?.date || report?.reportDate || report?.sourceDate) !== policy.todayDate) return;
    const storeKey = normalizeStoreKey(report?.storeName || report?.store || report?.storeKey || '');
    if (storeKey && expectedStoreMap.has(storeKey)) reportedStoreKeys.add(storeKey);
  });

  const missingRows = [...expectedStoreMap.entries()]
    .filter(([storeKey]) => !reportedStoreKeys.has(storeKey))
    .map(([, row]) => row);

  if (!policy.cutoffReached) {
    return {
      ready: true,
      chip: {
        key: 'reporting',
        label: '今日回報',
        value: expectedRows.length > 0 ? '回報進行中' : '今日無需回報',
        tone: 'neutral',
        hint: expectedRows.length > 0 ? '18:00 後再判斷今日缺報，不提前製造警示。' : '依營業日與店家生命週期，今日沒有應回報店家。',
      },
      action: null,
      missingStoreKeys: missingRows.map((row) => normalizeStoreKey(row?.storeKey)),
      expectedStoreCount: expectedRows.length,
      reportedStoreCount: reportedStoreKeys.size,
    };
  }

  if (expectedRows.length === 0) {
    return {
      ready: true,
      chip: { key: 'reporting', label: '今日回報', value: '今日無需回報', tone: 'positive', hint: '今日沒有應回報店家。' },
      action: null,
      missingStoreKeys: [],
      expectedStoreCount: 0,
      reportedStoreCount: 0,
    };
  }

  if (missingRows.length === 0) {
    return {
      ready: true,
      chip: { key: 'reporting', label: '今日回報', value: '已完成', tone: 'positive', hint: `${expectedRows.length} 家應回報店家皆已完成。` },
      action: null,
      missingStoreKeys: [],
      expectedStoreCount: expectedRows.length,
      reportedStoreCount: reportedStoreKeys.size,
    };
  }

  const sampleNames = missingRows.slice(0, 3).map((row) => row?.canonicalStoreName || row?.storeKey).filter(Boolean);
  return {
    ready: true,
    chip: {
      key: 'reporting',
      label: '今日回報',
      value: `缺 ${missingRows.length} 家`,
      tone: 'warning',
      hint: `已過 18:00，${reportedStoreKeys.size}/${expectedRows.length} 家完成今日回報。`,
    },
    action: {
      id: 'reporting-missing',
      kind: 'reporting',
      priority: 95,
      tone: 'warning',
      title: `${missingRows.length} 家店今日回報待完成`,
      detail: sampleNames.length > 0
        ? `${sampleNames.join('、')}${missingRows.length > sampleNames.length ? ' 等店家' : ''}尚未完成今日回報。`
        : '今日仍有應回報店家尚未完成。',
      impact: '目前即時營運總額仍可能是部分資料，建議先完成回報再判斷全品牌表現。',
      ctaType: 'audit',
      ctaLabel: '查看回報檢核',
      count: missingRows.length,
    },
    missingStoreKeys: missingRows.map((row) => normalizeStoreKey(row?.storeKey)),
    expectedStoreCount: expectedRows.length,
    reportedStoreCount: reportedStoreKeys.size,
  };
};

const buildTargetState = ({ formalAuthority, visibleStoreKeys }) => {
  const targetAuthority = formalAuthority?.targetAuthority || null;
  if (!formalAuthority?.compatible || formalAuthority?.lifecycleReady !== true || !targetAuthority) {
    return {
      chip: { key: 'target', label: '本月目標', value: '資料整理中', tone: 'neutral', hint: '正在確認本月正式店家與目標完整度。' },
      action: null,
      missingStoreKeys: [],
    };
  }

  if (targetAuthority.coverageConsistent !== true) {
    return {
      chip: { key: 'target', label: '本月目標', value: '資料整理中', tone: 'neutral', hint: '目標完整度正在與正式店家範圍對齊。' },
      action: null,
      missingStoreKeys: [],
    };
  }

  const visibleSet = new Set((visibleStoreKeys || []).map(normalizeStoreKey).filter(Boolean));
  const missing = new Set([
    ...(targetAuthority.cashMissingStoreKeys || []),
    ...(targetAuthority.accrualMissingStoreKeys || []),
  ].map(normalizeStoreKey).filter(Boolean));

  const scopedMissing = [...missing].filter((storeKey) => visibleSet.has(storeKey));
  if (scopedMissing.length === 0) {
    return {
      chip: { key: 'target', label: '本月目標', value: '已完整', tone: 'positive', hint: '目前可見店家皆有正式月目標資料。' },
      action: null,
      missingStoreKeys: [],
    };
  }

  const missingDisplayNames = scopedMissing.map((storeKey) => (
    formalAuthority?.stores?.[storeKey]?.canonicalStoreName || `${storeKey}店`
  ));

  return {
    chip: {
      key: 'target',
      label: '本月目標',
      value: `缺 ${scopedMissing.length} 家`,
      tone: 'warning',
      hint: '缺少正式目標的店家不會被硬算成 0，也不應進入錯誤排名。',
    },
    action: {
      id: 'target-missing',
      kind: 'target',
      priority: 80,
      tone: 'warning',
      title: `${scopedMissing.length} 家店本月目標待補`,
      detail: `${missingDisplayNames.slice(0, 3).join('、')}${missingDisplayNames.length > 3 ? ' 等店家' : ''}的正式月目標尚未完整。`,
      impact: '相關達成率與排名會維持 N/A，避免用不完整目標做錯誤判斷。',
      ctaType: '',
      ctaLabel: '',
      count: scopedMissing.length,
    },
    missingStoreKeys: scopedMissing,
  };
};

const buildSecurityState = ({ securityActionSummary }) => {
  if (securityActionSummary?.eligible !== true) {
    return {
      chip: { key: 'security', label: '安全確認', value: '依權限', tone: 'neutral', hint: '安全待辦只顯示給具最高管理權限的使用者。' },
      action: null,
    };
  }

  if (securityActionSummary?.ready !== true) {
    return {
      chip: { key: 'security', label: '安全確認', value: '檢查中', tone: 'neutral', hint: '正在確認是否有需要主管處理的新裝置。' },
      action: null,
    };
  }

  if (securityActionSummary?.error) {
    return {
      chip: { key: 'security', label: '安全確認', value: '暫不可用', tone: 'warning', hint: '裝置安全摘要暫時無法確認，請稍後再試。' },
      action: null,
    };
  }

  const count = Math.max(0, Number(securityActionSummary?.pendingCount || 0));
  if (count === 0) {
    return {
      chip: { key: 'security', label: '安全確認', value: '無待處理', tone: 'positive', hint: '目前沒有需要最高管理者協助的新裝置申請。' },
      action: null,
    };
  }

  return {
    chip: { key: 'security', label: '安全確認', value: `待處理 ${count}`, tone: 'critical', hint: '有新裝置需要最高管理者確認。' },
    action: {
      id: 'security-device-approval',
      kind: 'security',
      priority: 100,
      tone: 'critical',
      title: `${count} 筆新裝置需要確認`,
      detail: '目前有裝置申請需要最高管理者完成安全確認。',
      impact: '安全確認屬登入權限流程，建議優先處理。',
      ctaType: 'security',
      ctaLabel: '查看安全確認',
      count,
    },
  };
};

const buildPerformanceState = ({
  dashboardStats,
  storeRankings,
  policy,
  reportingState,
}) => {
  const daysPassed = Number(dashboardStats?.daysPassed || 0);
  const projectionValue = dashboardStats?.grandTotal?.projection;
  const targetValue = dashboardStats?.grandTotal?.formalCashTarget ?? dashboardStats?.grandTotal?.budget;
  const projection = isFiniteNumber(projectionValue) ? projectionValue : null;
  const target = isFiniteNumber(targetValue) ? targetValue : null;
  const reportingComplete = dashboardStats?.formalKpiStatus?.reportingStatus === 'DATA_COMPLETE';
  const validProjection = projection !== null && target !== null && target > 0;

  if (daysPassed <= ACTION_CENTER_EARLY_MONTH_DAYS) {
    return {
      chip: { key: 'performance', label: '月底推估', value: '月初觀察期', tone: 'neutral', hint: `前 ${ACTION_CENTER_EARLY_MONTH_DAYS} 個觀察日不把一般落後判定成主管警示。` },
      action: null,
      projectedAchievement: validProjection ? (projection / target) * 100 : null,
    };
  }

  if (!validProjection) {
    return {
      chip: { key: 'performance', label: '月底推估', value: '尚未可判斷', tone: 'neutral', hint: '目前尚未形成可比較的月底推估與正式目標。' },
      action: null,
      projectedAchievement: null,
    };
  }

  const projectedAchievement = (projection / target) * 100;
  const rounded = Math.round(projectedAchievement);
  const baseChip = {
    key: 'performance',
    label: '月底推估',
    value: `${rounded}%`,
    tone: projectedAchievement < ACTION_CENTER_PERFORMANCE_THRESHOLD_PERCENT ? 'warning' : 'positive',
    hint: '以目前 Dashboard 既有 Projection 與正式目標比較，不另外建立店家預測模型。',
  };

  // Before the reporting cutoff, or while today's required reporting is incomplete,
  // keep Projection visible as context but do not turn it into a management action.
  const todayReportingComplete = reportingState?.ready === true
    && policy.cutoffReached === true
    && reportingState?.missingStoreKeys?.length === 0;
  if (!reportingComplete || !todayReportingComplete) {
    return {
      chip: { ...baseChip, tone: 'neutral', hint: '今日回報尚未完成前，月底推估只作參考，不升級成主管待辦。' },
      action: null,
      projectedAchievement,
    };
  }

  if (projectedAchievement >= ACTION_CENTER_PERFORMANCE_THRESHOLD_PERCENT) {
    return { chip: baseChip, action: null, projectedAchievement };
  }

  const gap = Math.max(0, target - projection);
  const supportingStores = (Array.isArray(storeRankings) ? storeRankings : [])
    .filter((row) => row?.isBottomSegment === true && row?.dashboardLiveRankEligible === true)
    .slice(0, 3)
    .map((row) => row?.storeName)
    .filter(Boolean);

  return {
    chip: baseChip,
    action: {
      id: 'performance-projection',
      kind: 'performance',
      priority: 70,
      tone: 'attention',
      title: '月底推估需要關注',
      detail: `依目前進度，月底約可達正式目標的 ${rounded}%。${supportingStores.length ? ` 目前排名後段：${supportingStores.join('、')}。` : ''}`,
      impact: gap > 0 ? `預估與正式目標差距約 ${formatMoneyShort(gap)}。` : '目前推估低於設定的關注門檻。',
      ctaType: supportingStores.length > 0 ? 'store' : '',
      ctaLabel: supportingStores.length > 0 ? '查看單店分析' : '',
      storeName: supportingStores[0] || '',
      projectedAchievement,
      gap,
    },
    projectedAchievement,
  };
};

export const buildActionCenterState = ({
  selectedYearMonth = '',
  brandName = '',
  reports = [],
  formalAuthority = null,
  visibleStoreKeys = [],
  storeRankings = [],
  dashboardStats = null,
  securityActionSummary = null,
  storeSelfViewActive = false,
  now = new Date(),
} = {}) => {
  const policy = getDailyAuditPolicy(now);
  const isCurrentMonth = String(selectedYearMonth || '') === policy.todayYearMonth;

  if (!isCurrentMonth || storeSelfViewActive === true) {
    return {
      version: ACTION_CENTER_VERSION,
      visible: false,
      reason: !isCurrentMonth ? 'CURRENT_MONTH_ONLY' : 'STORE_SELF_VIEW_EXCLUDED',
      brandName,
      scopeStoreCount: 0,
      summary: [],
      actions: [],
      totalActionCount: 0,
      hiddenActionCount: 0,
    };
  }

  const formalReady = formalAuthority?.compatible === true && formalAuthority?.lifecycleReady === true;
  const authorityRows = formalReady
    ? getVisibleAuthorityRows({ formalAuthority, visibleStoreKeys })
    : null;

  const reportingState = buildReportingState({ policy, authorityRows, reports });
  const targetState = buildTargetState({ formalAuthority, visibleStoreKeys });
  const securityState = buildSecurityState({ securityActionSummary });
  const performanceState = buildPerformanceState({
    dashboardStats,
    storeRankings,
    policy,
    reportingState,
  });

  const allActions = [
    securityState.action,
    reportingState.action,
    targetState.action,
    performanceState.action,
  ].filter(Boolean).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  const actions = allActions.slice(0, ACTION_CENTER_MAX_ACTIONS);
  return {
    version: ACTION_CENTER_VERSION,
    visible: true,
    reason: 'CURRENT_MONTH_STORE_MODE',
    brandName,
    scopeStoreCount: Array.isArray(authorityRows) ? authorityRows.length : 0,
    summary: [
      reportingState.chip,
      performanceState.chip,
      targetState.chip,
      securityState.chip,
    ],
    actions,
    totalActionCount: allActions.length,
    hiddenActionCount: Math.max(0, allActions.length - actions.length),
    reporting: {
      expectedStoreCount: reportingState.expectedStoreCount,
      reportedStoreCount: reportingState.reportedStoreCount,
      missingStoreCount: reportingState.missingStoreKeys.length,
      cutoffReached: policy.cutoffReached,
    },
    projectedAchievement: performanceState.projectedAchievement,
  };
};

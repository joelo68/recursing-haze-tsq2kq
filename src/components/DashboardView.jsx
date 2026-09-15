// src/components/DashboardView.jsx
import React, { useContext } from "react";
// 👇 已經幫您在這裡補上 CheckCircle 了！
import { Loader2, CheckCircle } from "lucide-react";
import { ViewWrapper } from "./SharedUI";
import { AppContext } from "../AppContext";

import { useDashboardStats } from "../hooks/useDashboardStats";
import DashboardHeader from "./DashboardHeader";
import StorePerformanceView from "./StorePerformanceView";
import TherapistPerformanceView from "./TherapistPerformanceView";

const DashboardSectionLoading = ({ label }) => (
  <div
    className="flex min-h-[36vh] items-center justify-center flex-col animate-in fade-in duration-300"
    data-dashboard-section-loading="true"
  >
    <Loader2 className="w-10 h-10 animate-spin text-stone-300 mb-3" />
    <span className="text-stone-400 font-bold tracking-widest text-sm">{label}</span>
  </div>
);

const DashboardView = () => {
  const { userRole, therapistModuleEnabled, systemExclusionState } = useContext(AppContext);
  const isTherapistModuleEnabled = therapistModuleEnabled !== false;

  // ★ 召喚完美封裝的外接大腦！
  const {
    viewMode, setViewMode,
    selectedDashboardManager, setSelectedDashboardManager,
    selectedDashboardStore, setSelectedDashboardStore,
    brandInfo, brandPrefix,
    dashboardStats, myStoreRankings, therapistStats,
    dashboardSummaryStatus,
    dailyLoginCount, yesterdayLoginCount,
    groupedStoresForFilter, availableStoresForDropdown,
    officialStoresForDropdown, delegatedStoresForDropdown, delegatedStoreDetails
  } = useDashboardStats();

  // B1C2E-UX2B：店家範圍控制只在 System Exclusion authority
  // 已對準目前品牌後才公開，避免 authority 尚未 ready 時短暫顯示被排除店家。
  const dashboardStoreScopeReady = Boolean(
    systemExclusionState?.ready === true
      && String(systemExclusionState?.brandId || "").trim().toLowerCase()
        === String(brandInfo?.id || "").trim().toLowerCase()
  );

  // B1C2E-UX2A：Dashboard 外殼與目前視角的資料 readiness 分離。
  // 門市視角不再被 therapistStats 阻塞；人員視角也不必等待 dashboardStats。
  const isStoreViewActive = (
    viewMode === 'store'
    && userRole !== 'therapist'
    && userRole !== 'trainer'
  );
  const isTherapistViewActive = isTherapistModuleEnabled && viewMode === 'therapist';

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10 w-full min-w-0 relative">
        
        {/* 1. 零件一：控制面板 */}
        <DashboardHeader 
           brandInfo={brandInfo}
           dailyLoginCount={dailyLoginCount}
           yesterdayLoginCount={yesterdayLoginCount}
           dashboardSummaryStatus={dashboardSummaryStatus}
           dashboardKpiStatus={dashboardStats?.formalKpiStatus || {}}
           storeScopeReady={dashboardStoreScopeReady}
           viewMode={viewMode}
           setViewMode={setViewMode}
           selectedDashboardManager={selectedDashboardManager}
           setSelectedDashboardManager={setSelectedDashboardManager}
           selectedDashboardStore={selectedDashboardStore}
           setSelectedDashboardStore={setSelectedDashboardStore}
           groupedStoresForFilter={groupedStoresForFilter}
           availableStoresForDropdown={availableStoresForDropdown}
           officialStoresForDropdown={officialStoresForDropdown}
           delegatedStoresForDropdown={delegatedStoresForDropdown}
           delegatedStoreDetails={delegatedStoreDetails}
        />

        {/* 2. 零件二：門市營運視圖 */}
        {isStoreViewActive && (
          dashboardStats ? (
            <StorePerformanceView
              dashboardStats={dashboardStats}
              myStoreRankings={myStoreRankings}
              brandInfo={brandInfo}
            />
          ) : (
            <DashboardSectionLoading label="門市營運資料載入中..." />
          )
        )}

        {/* 3. 零件三：人員績效視圖 */}
        {isTherapistViewActive && (
          therapistStats ? (
            <TherapistPerformanceView
              therapistStats={therapistStats}
              brandInfo={brandInfo}
            />
          ) : (
            <DashboardSectionLoading label="人員績效資料載入中..." />
          )
        )}
        
      </div>
    </ViewWrapper>
  );
};

export default DashboardView;
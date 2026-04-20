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

const DashboardView = () => {
  const { userRole } = useContext(AppContext);

  // ★ 召喚完美封裝的外接大腦！
  const {
    viewMode, setViewMode,
    selectedDashboardManager, setSelectedDashboardManager,
    selectedDashboardStore, setSelectedDashboardStore,
    brandInfo, brandPrefix,
    dashboardStats, myStoreRankings, therapistStats,
    dailyLoginCount, yesterdayLoginCount,
    groupedStoresForFilter, availableStoresForDropdown
  } = useDashboardStats();

  if (!dashboardStats || !therapistStats) {
      return (
          <ViewWrapper>
              <div className="flex h-[50vh] items-center justify-center flex-col animate-in fade-in duration-300">
                  <Loader2 className="w-12 h-12 animate-spin text-stone-300 mb-4" />
                  <span className="text-stone-400 font-bold tracking-widest text-sm">Dashboard 數據載入中...</span>
              </div>
          </ViewWrapper>
      );
  }

  return (
    <ViewWrapper>
      <div className="space-y-8 pb-10 w-full min-w-0 relative">
        
        {/* 1. 零件一：控制面板 */}
        <DashboardHeader 
           brandInfo={brandInfo}
           dailyLoginCount={dailyLoginCount}
           yesterdayLoginCount={yesterdayLoginCount}
           viewMode={viewMode}
           setViewMode={setViewMode}
           selectedDashboardManager={selectedDashboardManager}
           setSelectedDashboardManager={setSelectedDashboardManager}
           selectedDashboardStore={selectedDashboardStore}
           setSelectedDashboardStore={setSelectedDashboardStore}
           groupedStoresForFilter={groupedStoresForFilter}
           availableStoresForDropdown={availableStoresForDropdown}
        />

        {/* 2. 零件二：門市營運視圖 */}
        {(viewMode === 'store' && userRole !== 'therapist' && userRole !== 'trainer') && (
           <StorePerformanceView 
              dashboardStats={dashboardStats} 
              myStoreRankings={myStoreRankings} 
              brandInfo={brandInfo}
           />
        )}
        
        {/* 3. 零件三：人員績效視圖 */}
        {viewMode === 'therapist' && (
           <TherapistPerformanceView 
              therapistStats={therapistStats} 
              brandInfo={brandInfo} 
           />
        )}
        
      </div>
    </ViewWrapper>
  );
};

export default DashboardView;
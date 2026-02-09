// src/components/SmartCalendar.jsx
import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// ★ iPhone/Safari 專用：日期轉換小幫手
const safeParseDate = (dateInput) => {
  if (!dateInput) return new Date();
  
  // 如果是字串，就把 - 換成 / (解決 iOS 兼容性問題)
  const dateStr = typeof dateInput === 'string' 
    ? dateInput.replace(/-/g, '/') 
    : dateInput;
    
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const SmartCalendar = ({
  selectedDate,
  onDateSelect,
  stores = [],
  salesData = [],
  onClose,
}) => {
  const [currentDate, setCurrentDate] = useState(() => safeParseDate(selectedDate));

  useEffect(() => {
    if (selectedDate) {
      setCurrentDate(safeParseDate(selectedDate));
    }
  }, [selectedDate]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  // --- 數據分析邏輯 ---
  const getDayStatus = (day) => {
    // ★★★ 修正點：加入未來日期判斷 ★★★
    const checkDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 將時間歸零，只比較日期

    // 如果該日期 > 今天 (即明天以後)，不顯示任何燈號
    if (checkDate > today) return "none";

    if (!salesData || salesData.length === 0) return "none";

    // 格式化當前日期 YYYY-MM-DD
    const targetDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const targetDateSlash = targetDate.replace(/-/g, "/");

    // 1. 找出當天所有銷售紀錄
    const dayRecords = salesData.filter((record) => {
      if (!record.date) return false;
      return record.date.replace(/-/g, "/") === targetDateSlash;
    });

    if (dayRecords.length === 0) return "none";

    // 2. 判斷是否有店家名單需要檢查
    if (!stores || (Array.isArray(stores) && stores.length === 0) || (typeof stores === 'object' && Object.keys(stores).length === 0)) {
        return "complete"; 
    }

    // 3. 有店家名單，檢查是否全數回報
    let allStoreNames = [];
    if (Array.isArray(stores)) {
      stores.forEach(manager => {
        if(manager.stores) {
          manager.stores.forEach(s => allStoreNames.push(typeof s === 'string' ? s : s.name));
        }
      });
    } else {
       Object.values(stores).forEach(list => {
          if(Array.isArray(list)) list.forEach(s => allStoreNames.push(typeof s === 'string' ? s : s.name));
       });
    }
    
    // 如果資料筆數 >= 店家總數，算完成
    return dayRecords.length >= allStoreNames.length ? "complete" : "incomplete";
  };

  // --- 操作處理 ---
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleDateClick = (day) => {
    const newDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onDateSelect(newDate);
    if (onClose) onClose();
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-xl border border-stone-100 w-[320px] select-none">
      {/* 標題區 */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevMonth}
          className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600"
        >
          <ChevronLeft size={20} />
        </button>
        <h3 className="font-bold text-stone-800 text-lg">
          {year}年 {month + 1}月
        </h3>
        <button
          onClick={handleNextMonth}
          className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* 星期標題 */}
      <div className="grid grid-cols-7 mb-2">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="text-center text-xs font-bold text-stone-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* 日期格子 */}
      <div className="grid grid-cols-7 gap-1">
        {/* 補空白 */}
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {/* 畫日期 */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === selectedDate;
          const status = getDayStatus(day);

          return (
            <button
              key={day}
              onClick={() => handleDateClick(day)}
              className={`
                relative h-9 rounded-lg text-sm font-bold flex items-center justify-center transition-all
                ${isSelected 
                  ? "bg-stone-800 text-white shadow-md scale-105 z-10" 
                  : "text-stone-700 hover:bg-stone-100"
                }
              `}
            >
              {day}
              
              {/* 狀態點點 */}
              {!isSelected && status !== "none" && (
                <span className={`
                  absolute bottom-1 w-1.5 h-1.5 rounded-full
                  ${status === "complete" ? "bg-emerald-400" : "bg-rose-500"}
                `} />
              )}
            </button>
          );
        })}
      </div>
      
      {/* 關閉按鈕 (手機版 Modal 用) */}
      {onClose && (
        <button 
           onClick={onClose}
           className="mt-4 w-full py-2 bg-stone-100 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-200 transition-colors md:hidden"
        >
          關閉
        </button>
      )}
    </div>
  );
};

export default SmartCalendar;
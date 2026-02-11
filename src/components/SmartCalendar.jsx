// src/components/SmartCalendar.jsx
import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ★ iPhone/Safari 專用：日期轉換小幫手
const safeParseDate = (dateInput) => {
  if (!dateInput) return new Date();
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

  // --- ★★★ 核心修正：數據分析邏輯 (改用「點名法」且不隱藏空資料) ★★★ ---
  const getDayStatus = (day) => {
    const checkDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 未來日期不顯示任何燈號
    if (checkDate > today) return "none";

    // 格式化當前日期 YYYY-MM-DD
    const targetDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    
    // 1. 找出當天所有銷售紀錄 (統一日期格式為 YYYY-MM-DD 進行比對)
    const dayRecords = salesData.filter((record) => {
      if (!record.date) return false;
      return record.date.replace(/\//g, "-") === targetDate;
    });

    // ★ 關鍵修正：這裡移除了 "if (dayRecords.length === 0) return 'none'"
    // 即使當天沒人回報 (dayRecords 為空)，只要有設定店家 (stores)，就應該顯示紅燈！

    // 2. 判斷是否有店家名單
    // 如果連「應檢核店家」都沒有，才真的不顯示燈號
    if (!stores || (Array.isArray(stores) && stores.length === 0)) {
        return "none"; 
    }

    // 3. 逐一檢查每個「應回報單位」是否已回報 (點名法)
    const isAllSubmitted = stores.every(target => {
        // 取出該店家的所有合法別名 (例如 ["中山", "中山店", "安妞中山店"])
        // 這些別名是由 AuditView 準備好的
        const aliases = Array.isArray(target.stores) 
            ? target.stores.map(s => typeof s === 'string' ? s : s.name)
            : [];
            
        if (aliases.length === 0) return true; // 沒設定別名就當作不用檢查

        // 檢查：本日收到的日報中，有沒有任何一筆屬於這個別名列表？
        // 只要命中一個別名 (例如 "安妞中山店")，就算該店已回報
        const hasRecord = dayRecords.some(record => aliases.includes(record.storeName));
        
        return hasRecord;
    });

    // 如果所有店家都打勾，就是綠燈 (complete)，否則紅燈 (incomplete)
    return isAllSubmitted ? "complete" : "incomplete";
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
        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

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
// src/components/SmartCalendar.jsx
import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  maxDate, // ★ 接收 maxDate (不可大於此日期)
  minDate  // ★ 接收 minDate (不可小於此日期)
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

  const getDayStatus = (day) => {
    const checkDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkDate > today) return "none";

    const targetDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    
    const dayRecords = salesData.filter((record) => {
      if (!record.date) return false;
      return record.date.replace(/\//g, "-") === targetDate;
    });

    if (!stores || (Array.isArray(stores) && stores.length === 0)) {
        return "none"; 
    }

    const isAllSubmitted = stores.every(target => {
        const aliases = Array.isArray(target.stores) 
            ? target.stores.map(s => typeof s === 'string' ? s : s.name)
            : [];
            
        if (aliases.length === 0) return true; 

        return dayRecords.some(record => aliases.includes(record.storeName));
    });

    return isAllSubmitted ? "complete" : "incomplete";
  };

  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const handleDateClick = (day) => {
    const newDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onDateSelect(newDate);
    if (onClose) onClose();
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-xl border border-stone-100 w-[320px] select-none">
      <div className="flex items-center justify-between mb-4">
        <button onClick={handlePrevMonth} className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600">
          <ChevronLeft size={20} />
        </button>
        <h3 className="font-bold text-stone-800 text-lg">{year}年 {month + 1}月</h3>
        <button onClick={handleNextMonth} className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="text-center text-xs font-bold text-stone-400 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = dateStr === selectedDate;
          const status = getDayStatus(day);
          
          // ★ 核心防呆邏輯：判斷是否超出範圍
          const isFuture = maxDate && dateStr > maxDate;
          const isPast = minDate && dateStr < minDate;
          const isDisabled = isFuture || isPast;

          return (
            <button
              key={day}
              onClick={() => !isDisabled && handleDateClick(day)} 
              disabled={isDisabled} 
              className={`
                relative h-9 rounded-lg text-sm font-bold flex items-center justify-center transition-all
                ${isDisabled ? "text-stone-300 opacity-40 cursor-not-allowed bg-transparent" : 
                  isSelected ? "bg-stone-800 text-white shadow-md scale-105 z-10" : 
                  "text-stone-700 hover:bg-stone-100"
                }
              `}
            >
              {day}
              {!isSelected && !isDisabled && status !== "none" && (
                <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${status === "complete" ? "bg-emerald-400" : "bg-rose-500"}`} />
              )}
            </button>
          );
        })}
      </div>
      
      {onClose && (
        <button onClick={onClose} className="mt-4 w-full py-2 bg-stone-100 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-200 transition-colors md:hidden">
          關閉
        </button>
      )}
    </div>
  );
};

export default SmartCalendar;
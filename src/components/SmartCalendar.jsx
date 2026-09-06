// src/components/SmartCalendar.jsx
import React, { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const safeParseDate = (dateInput) => {
  if (!dateInput) return new Date();
  const dateStr = typeof dateInput === "string"
    ? dateInput.replace(/-/g, "/")
    : dateInput;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const normalizeDateList = (values = []) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
)].sort();

const SmartCalendar = ({
  selectedDate,
  onDateSelect,
  stores = [],
  salesData = [],
  onClose,
  maxDate,
  minDate,
  min,
  max,
  multiSelect = false,
  selectedDates = [],
  onDateToggle,
  disabledDates = [],
  statusHiddenDates = [],
  selectedDateLabel = "休",
  disabledDateLabel = "全休",
  embedded = false,
  onMonthChange,
}) => {
  const [currentDate, setCurrentDate] = useState(() => safeParseDate(selectedDate));
  const selectedDateSet = useMemo(() => new Set(normalizeDateList(selectedDates)), [selectedDates]);
  const disabledDateSet = useMemo(() => new Set(normalizeDateList(disabledDates)), [disabledDates]);
  const statusHiddenDateSet = useMemo(() => new Set(normalizeDateList(statusHiddenDates)), [statusHiddenDates]);

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

    const isAllSubmitted = stores.every((target) => {
      const aliases = Array.isArray(target.stores)
        ? target.stores.map((s) => typeof s === "string" ? s : s.name)
        : [];

      if (aliases.length === 0) return true;

      return dayRecords.some((record) => aliases.includes(record.storeName));
    });

    return isAllSubmitted ? "complete" : "incomplete";
  };

  const publishMonthChange = (date) => {
    if (typeof onMonthChange !== "function") return;
    onMonthChange({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    });
  };

  const handlePrevMonth = () => {
    const next = new Date(year, month - 1, 1);
    setCurrentDate(next);
    publishMonthChange(next);
  };

  const handleNextMonth = () => {
    const next = new Date(year, month + 1, 1);
    setCurrentDate(next);
    publishMonthChange(next);
  };

  const handleDateClick = (day) => {
    const newDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (multiSelect && typeof onDateToggle === "function") {
      onDateToggle(newDate);
      return;
    }
    onDateSelect?.(newDate);
    if (onClose) onClose();
  };

  const parseBoundaryTime = (boundaryObj, boundaryStr) => {
    if (boundaryObj instanceof Date) return boundaryObj.getTime();
    if (typeof boundaryObj === "string") return new Date(boundaryObj.replace(/-/g, "/")).getTime();
    if (typeof boundaryStr === "string") return new Date(boundaryStr.replace(/-/g, "/")).getTime();
    return null;
  };

  const minBoundaryTime = parseBoundaryTime(minDate, min);
  const maxBoundaryTime = parseBoundaryTime(maxDate, max);

  return (
    <div className={`bg-white select-none ${embedded ? "w-full" : "p-4 rounded-xl shadow-xl border border-stone-100 w-[320px]"}`}>
      <div className={`flex items-center justify-between ${embedded ? "mb-5" : "mb-4"}`}>
        <button type="button" onClick={handlePrevMonth} className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600">
          <ChevronLeft size={20} />
        </button>
        <h3 className="font-bold text-stone-800 text-lg">{year}年 {month + 1}月</h3>
        <button type="button" onClick={handleNextMonth} className="p-1 hover:bg-stone-100 rounded-lg transition-colors text-stone-600">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="text-center text-xs font-bold text-stone-400 py-1">{d}</div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${embedded ? "gap-2" : "gap-1"}`}>
        {Array.from({ length: firstDayOfMonth }).map((_, i) => <div key={`empty-${i}`} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isSelected = multiSelect ? selectedDateSet.has(dateStr) : dateStr === selectedDate;
          const status = statusHiddenDateSet.has(dateStr) ? "none" : getDayStatus(day);

          const currentDayTime = new Date(year, month, day).getTime();
          const isBeforeMin = minBoundaryTime ? currentDayTime < minBoundaryTime : false;
          const isAfterMax = maxBoundaryTime ? currentDayTime > maxBoundaryTime : false;
          const isLockedDate = disabledDateSet.has(dateStr);
          const isDisabled = isBeforeMin || isAfterMax || isLockedDate;

          const selectedDisabled = isSelected && (isBeforeMin || isAfterMax);
          const dayClass = multiSelect
            ? (isLockedDate
              ? "bg-amber-100 text-amber-700 border border-amber-200 cursor-not-allowed"
              : selectedDisabled
                ? "bg-rose-100 text-rose-500 border border-rose-200 cursor-not-allowed"
                : isDisabled
                  ? "text-stone-300 opacity-30 cursor-not-allowed bg-stone-50/50"
                  : isSelected
                    ? "bg-rose-500 text-white shadow-md shadow-rose-200 scale-[0.98] z-10"
                    : "bg-white text-stone-700 border border-stone-200 hover:border-amber-400 cursor-pointer")
            : (isDisabled
              ? "text-stone-300 opacity-30 cursor-not-allowed bg-stone-50/50"
              : isSelected
                ? "bg-stone-800 text-white shadow-md scale-105 z-10"
                : "text-stone-700 hover:bg-stone-100 cursor-pointer");

          return (
            <button
              type="button"
              key={day}
              onClick={() => !isDisabled && handleDateClick(day)}
              disabled={isDisabled}
              className={`
                relative font-bold flex items-center justify-center transition-all
                ${embedded ? "min-h-14 md:min-h-20 text-sm rounded-xl" : "h-9 text-sm rounded-lg"}
                ${dayClass}
              `}
            >
              <span>{day}</span>
              {multiSelect && isSelected && (
                <span className={`absolute bottom-1 text-[8px] ${selectedDisabled ? "text-rose-400" : "text-white/85"}`}>
                  {selectedDateLabel}
                </span>
              )}
              {isLockedDate && (
                <span className="absolute bottom-1 text-[8px] text-amber-700/80">
                  {disabledDateLabel}
                </span>
              )}
              {!multiSelect && !isSelected && !isDisabled && status !== "none" && (
                <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${status === "complete" ? "bg-emerald-400" : "bg-rose-500"}`} />
              )}
            </button>
          );
        })}
      </div>

      {onClose && !multiSelect && (
        <button type="button" onClick={onClose} className="mt-4 w-full py-2 bg-stone-100 text-stone-600 rounded-lg text-sm font-bold hover:bg-stone-200 transition-colors md:hidden">
          關閉
        </button>
      )}
    </div>
  );
};

export default SmartCalendar;

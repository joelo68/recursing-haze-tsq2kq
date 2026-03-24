import React, { useState, useRef, useEffect } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import SmartCalendar from "./SmartCalendar";

const SmartDatePicker = ({ selectedDate, onDateSelect, stores, salesData, maxDate }) => { // ★ 新增 maxDate
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // 點擊外部自動關閉
  useEffect(() => {
    const handleClickOutside = (event) => {
      // 如果是手機版 Modal 模式，我們透過遮罩層關閉，不依賴這裡
      if (window.innerWidth >= 768) { 
        if (containerRef.current && !containerRef.current.contains(event.target)) {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}> {/* 外層加上 w-full */}
      {/* 1. 按鈕本體 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-3 bg-white border border-stone-200 px-4 py-2.5 rounded-xl text-stone-700 font-bold hover:bg-stone-50 transition-colors shadow-sm min-w-[180px]"
      >
        <span className="text-lg">{selectedDate}</span>
        <CalendarIcon size={18} className="text-stone-400 ml-auto" />
      </button>

      {/* 2. 彈出層邏輯 */}
      {isOpen && (
        <>
          {/* A. 手機版遮罩 (Mobile Only) - 點擊背景關閉 */}
          <div 
            className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-40 md:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* B. 日曆容器 */}
          <div className={`
            z-50 animate-in fade-in zoom-in-95 duration-200
            
            /* --- 手機版樣式 (強制置中) --- */
            fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
            
            /* --- 桌機版樣式 (下拉選單) --- */
            md:absolute md:top-full md:left-0 md:transform-none md:mt-2
          `}>
            <SmartCalendar 
              selectedDate={selectedDate}
              onDateSelect={onDateSelect}
              stores={stores}
              salesData={salesData}
              onClose={() => setIsOpen(false)}
              maxDate={maxDate} // ★ 將 maxDate 傳遞給日曆繪製元件
            />
          </div>
        </>
      )}
    </div>
  );
};

export default SmartDatePicker;
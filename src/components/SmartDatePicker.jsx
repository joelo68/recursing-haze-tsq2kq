import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom"; 
import { Calendar as CalendarIcon, X } from "lucide-react";
import SmartCalendar from "./SmartCalendar";

const SmartDatePicker = ({ selectedDate, onDateSelect, stores, salesData, maxDate, align = "left" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const calendarRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const measureCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 2, 
        left: rect.left + window.scrollX,
      });
    }
  };

  const toggleCalendar = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen) measureCoords();
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    if (isOpen && window.innerWidth >= 768 && containerRef.current && calendarRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const calendarRect = calendarRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      let leftPos = rect.left + window.scrollX;

      if (rect.left + calendarRect.width > viewportWidth) {
         leftPos = viewportWidth - calendarRect.width - 12; 
         if (leftPos < 0) leftPos = 12; 
      }

      setCoords({
        top: rect.bottom + window.scrollY + 2,
        left: leftPos
      });
    }
  }, [isOpen, selectedDate]); 

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (window.innerWidth >= 768) { 
        if (containerRef.current && containerRef.current.contains(event.target)) return; 
        if (calendarRef.current && !calendarRef.current.contains(event.target)) {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const DesktopCalendar = (
    <div ref={calendarRef} className="z-[9999] animate-in fade-in zoom-in-95 duration-200 absolute shadow-2xl rounded-2xl border border-stone-100 bg-white" style={{
      top: `${coords.top}px`,
      left: `${coords.left}px`,
    }}>
      <SmartCalendar 
        selectedDate={selectedDate}
        onDateSelect={(date) => {
          onDateSelect(date);
          setIsOpen(false); 
        }}
        stores={stores}
        salesData={salesData}
        onClose={() => setIsOpen(false)}
        maxDate={maxDate}
      />
    </div>
  );

  const MobileCalendar = (
    <>
      {/* 全螢幕背景遮罩 */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] animate-in fade-in duration-300" onClick={() => setIsOpen(false)}/>
      
      {/* 畫面中央的日曆彈窗 */}
      <div ref={calendarRef} className="z-[9999] animate-in fade-in zoom-in-95 duration-300 fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex justify-center items-center max-w-[95vw]">
         {/* ★ 核心修正：加入 w-fit 讓白框緊緊貼合日曆本體，拒絕多餘白邊！ */}
         <div className="overflow-hidden rounded-3xl shadow-2xl bg-white w-fit">
            <SmartCalendar 
              selectedDate={selectedDate}
              onDateSelect={(date) => {
                onDateSelect(date);
                setIsOpen(false); 
              }}
              stores={stores}
              salesData={salesData}
              onClose={() => setIsOpen(false)}
              maxDate={maxDate}
            />
         </div>
      </div>
    </>
  );

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button" 
        onClick={toggleCalendar}
        className="w-full flex items-center justify-between gap-3 bg-white border border-stone-200 px-3 py-2 rounded-lg text-stone-700 font-bold hover:bg-stone-50 transition-colors shadow-sm"
      >
        <span className="text-sm">{selectedDate}</span>
        <CalendarIcon size={14} className="text-stone-400 ml-auto shrink-0" />
      </button>

      {isOpen && ReactDOM.createPortal(
        window.innerWidth < 768 ? MobileCalendar : DesktopCalendar,
        document.body 
      )}
    </div>
  );
};

export default SmartDatePicker;
import React, { useState, useEffect } from 'react';
// ★ 替換點 1：將 getDoc 換成支援即時監聽的 onSnapshot
import { doc, onSnapshot } from 'firebase/firestore'; 
import { db } from '../config/firebase';

const LoginCounter = () => {
  const [targetCount, setTargetCount] = useState(0);
  const [displayCount, setDisplayCount] = useState(0);

  // ★ 替換點 2：將一次性抓取改為「即時監聽模式」
  useEffect(() => {
    const docRef = doc(db, "public_info", "stats");
    
    // onSnapshot 會建立一條即時連線，後端數字一變，前端立刻跟著變
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setTargetCount(docSnap.data().totalUsers || 100);
      } else {
        setTargetCount(100); 
      }
    }, (error) => {
      console.error("無法取得系統統計:", error);
      setTargetCount(100); 
    });

    // 當離開登入畫面時，自動關閉監聽以節省效能
    return () => unsubscribe();
  }, []);

  // 數字跳動動畫 (完全保持原樣)
  useEffect(() => {
    if (targetCount === 0) return;
    let current = 0;
    const step = Math.max(1, Math.ceil(targetCount / 40)); 
    const timer = setInterval(() => {
      current += step;
      if (current >= targetCount) {
        setDisplayCount(targetCount);
        clearInterval(timer);
      } else {
        setDisplayCount(current);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [targetCount]);

  if (targetCount === 0) return null; 

  // ★ 完全保留您原版的 UI 渲染與文案設計 ★
  return (
    <div className="mt-4 flex items-center justify-center animate-in fade-in duration-1000">
      <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-stone-200/50 border border-stone-200/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:bg-stone-200/80 cursor-default">
        
        {/* 低調的灰色呼吸燈，取代原本突兀的黑底大圖示 */}
        <div className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-pulse"></div>
        
        {/* 精品級文案與排版 */}
        <span className="text-[11px] font-medium text-stone-500 tracking-widest uppercase">
          授權使用 
          <span className="font-bold text-stone-700 text-[14px] mx-2 font-sans tracking-tight">
            {displayCount}
          </span>
          位夥伴
        </span>
        
      </div>
    </div>
  );
};

export default LoginCounter;
import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const LoginCounter = () => {
  const [targetCount, setTargetCount] = useState(0);
  const [displayCount, setDisplayCount] = useState(0);

  // 抓取人數邏輯 (保持原樣，極致省流量)
  useEffect(() => {
    const fetchUserCount = async () => {
      try {
        const docRef = doc(db, "public_info", "stats");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setTargetCount(docSnap.data().totalUsers || 100);
        } else {
          setTargetCount(100); 
        }
      } catch (error) {
        console.error("無法取得系統統計:", error);
        setTargetCount(100); 
      }
    };
    fetchUserCount();
  }, []);

  // 數字跳動動畫 (保持原樣)
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

  // ★ 改造重點：全新的 UI 渲染 ★
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
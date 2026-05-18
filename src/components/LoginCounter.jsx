import React, { useState, useEffect } from 'react';

// ★ 直接接收外面算好的精準數字 (totalUsers)
const LoginCounter = ({ totalUsers = 0 }) => {
  const [displayCount, setDisplayCount] = useState(0);

  // 數字跳動動畫 (保持您原本的完美設計)
  useEffect(() => {
    if (totalUsers === 0) return;
    let current = 0;
    const step = Math.max(1, Math.ceil(totalUsers / 40)); 
    const timer = setInterval(() => {
      current += step;
      if (current >= totalUsers) {
        setDisplayCount(totalUsers);
        clearInterval(timer);
      } else {
        setDisplayCount(current);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [totalUsers]);

  if (totalUsers === 0) return null; 

  return (
    <div className="mt-4 flex items-center justify-center animate-in fade-in duration-1000">
      <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-stone-200/50 border border-stone-200/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:bg-stone-200/80 cursor-default">
        <div className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-pulse"></div>
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
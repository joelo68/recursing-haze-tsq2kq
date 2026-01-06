// src/components/SharedUI.jsx
import React, { useEffect } from "react";
import { CheckCircle, AlertCircle, Bell } from "lucide-react";

export const ViewWrapper = ({ children }) => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 w-full">
    {children}
  </div>
);

export const Card = ({ title, subtitle, children, className = "" }) => (
  <div className={`bg-white p-6 rounded-3xl border border-stone-100 shadow-sm ${className}`}>
    {(title || subtitle) && (
      <div className="mb-6">
        {title && <h2 className="text-xl font-bold text-stone-800">{title}</h2>}
        {subtitle && <p className="text-sm text-stone-400 mt-1">{subtitle}</p>}
      </div>
    )}
    {children}
  </div>
);

export const Skeleton = ({ className }) => (
  <div className={`animate-pulse bg-stone-200 rounded-2xl ${className}`}></div>
);

export const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  
  const bgClass =
    type === "success" ? "bg-emerald-600"
    : type === "error" ? "bg-stone-700"
    : "bg-amber-600";
    
  return (
    <div className={`fixed bottom-20 md:bottom-6 right-6 ${bgClass} text-white px-6 py-3 rounded-full shadow-xl shadow-stone-300 flex items-center gap-3 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-300 max-w-[90vw]`}>
      {type === "success" ? <CheckCircle size={20} /> : type === "error" ? <AlertCircle size={20} /> : <Bell size={20} />}
      <span className="font-medium text-sm tracking-wide">{message}</span>
    </div>
  );
};

export const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
        <h3 className="text-lg font-bold text-stone-800 mb-2">{title}</h3>
        <p className="text-stone-500 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-stone-500 hover:bg-stone-50 font-bold transition-colors">取消</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-500 text-white rounded-xl hover:bg-rose-600 font-bold shadow-lg shadow-rose-200 transition-colors">確認</button>
        </div>
      </div>
    </div>
  );
};
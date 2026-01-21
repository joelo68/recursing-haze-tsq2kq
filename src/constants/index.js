// src/constants/index.js
import {
  LayoutDashboard,
  Map as MapIcon,
  Store,
  TrendingUp,
  ClipboardCheck,
  FileText,
  Upload,
  Activity,
  Settings,
  Calendar, 
  Target, 
  UserCog, 
  CalendarOff,
} from "lucide-react";

export const ROLES = {
  DIRECTOR: { id: "director", label: "總監", pass: "16500" },
  // ★ 新增角色：教專 (TRAINER)，密碼由資料庫控制
  TRAINER: { id: "trainer", label: "教專", pass: null }, 
  MANAGER: { id: "manager", label: "區長", pass: null },
  STORE: { id: "store", label: "店經理", pass: null },
  THERAPIST: { id: "therapist", label: "管理師", pass: null },
};

export const ALL_MENU_ITEMS = [
  { id: "dashboard", label: "營運總覽", icon: LayoutDashboard },
  { id: "annual", label: "年度分析", icon: Calendar },
  { id: "targets", label: "年度目標設定", icon: Target }, 
  { id: "regional", label: "區域分析", icon: MapIcon },
  { id: "store-analysis", label: "單店分析", icon: Store },
  { id: "ranking", label: "詳細報表", icon: TrendingUp },
  { id: "audit", label: "回報檢核", icon: ClipboardCheck },
  { id: "history", label: "數據修正", icon: FileText },
  { id: "input", label: "日報輸入", icon: Upload },
  { id: "logs", label: "系統監控", icon: Activity },
  { id: "t-targets", label: "管理師目標", icon: UserCog }, 
  { id: "t-schedule", label: "管理師排休", icon: CalendarOff },
  { id: "settings", label: "參數設定", icon: Settings },
];

export const DEFAULT_REGIONAL_MANAGERS = {
  Jonas: ["安平", "永康", "崇學", "大順", "前鎮", "左營"],
  Angel: ["古亭", "蘆洲", "北車", "三重", "桃園", "中壢", "八德"],
  漢娜: ["內湖", "安和", "士林", "南港", "頂溪", "園區", "新竹", "竹北"],
  婉娟: ["林口", "新莊", "北大", "河南", "站前", "豐原", "太平"],
  AA: ["仁愛", "板橋", "新店", "復北"],
};

export const DEFAULT_PERMISSIONS = {
  // 總監擁有所有權限
  director: ALL_MENU_ITEMS.map((i) => i.id),
  
  // ★ 教專權限：看人、不看店營收 (Ranking/Audit 需配合資料流過濾)
  trainer: ["dashboard", "ranking", "audit", "settings", "t-targets", "t-schedule"],

  manager: ["dashboard", "annual", "targets", "regional", "store-analysis", "audit", "t-targets", "t-schedule"],
  store: ["dashboard", "annual", "targets", "store-analysis", "ranking", "history", "input", "t-targets", "t-schedule"],
  therapist: ["dashboard", "input"],
};
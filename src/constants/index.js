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
  Bell,
  Users, // ★ 1. 補上這行，引入人員圖示
  Sparkles
} from "lucide-react";

// pathType: 'legacy' 代表舊路徑(CYJ), 'standard' 代表新架構(新品牌)
export const BRANDS = [
  { id: "cyj", label: "CYJ", pathType: "legacy" },
  { id: "anniu", label: "安妞", pathType: "standard" },
  { id: "yibo", label: "伊啵", pathType: "standard" },
];

export const APPLICATION_ROLE_METADATA = Object.freeze([
  Object.freeze({ id: "director", label: "高階主管", badgeLabel: "高階" }),
  Object.freeze({ id: "trainer", label: "教專", badgeLabel: "教專" }),
  Object.freeze({ id: "manager", label: "區長", badgeLabel: "區長" }),
  Object.freeze({ id: "store", label: "店經理", badgeLabel: "店經理" }),
  Object.freeze({ id: "therapist", label: "管理師", badgeLabel: "管理師" }),
]);

// `master` 是 Security / Audit 特殊 actor，不是可登入的 Application Identity role。
// 不可把這份 presentation metadata 當成 Backend / Rules authorization allowlist。
export const SECURITY_ACTOR_ROLE_METADATA = Object.freeze({
  master: Object.freeze({ id: "master", label: "最高管理者", badgeLabel: "最高管理者" }),
});

const APPLICATION_ROLE_METADATA_BY_ID = Object.freeze(
  Object.fromEntries(APPLICATION_ROLE_METADATA.map((role) => [role.id, role]))
);

export const APPLICATION_ROLE_IDS = Object.freeze(
  APPLICATION_ROLE_METADATA.map((role) => role.id)
);

export const ROLE_PRESENTATION_BY_ID = Object.freeze({
  ...APPLICATION_ROLE_METADATA_BY_ID,
  ...SECURITY_ACTOR_ROLE_METADATA,
});

export const getRolePresentation = (roleId = "") => (
  ROLE_PRESENTATION_BY_ID[String(roleId || "").trim().toLowerCase()] || null
);

export const getRoleLabel = (roleId = "", fallback = "") => {
  const normalizedFallback = String(fallback || "");
  return getRolePresentation(roleId)?.label || normalizedFallback || String(roleId || "");
};

export const getRoleBadgeLabel = (roleId = "", fallback = "") => {
  const normalizedFallback = String(fallback || "");
  const role = getRolePresentation(roleId);
  return role?.badgeLabel || role?.label || normalizedFallback || String(roleId || "");
};

export const ROLES = Object.freeze({
  // Login / Navigation 相容名稱；不保存 password / pass 等 credential-like metadata。
  DIRECTOR: APPLICATION_ROLE_METADATA_BY_ID.director,
  TRAINER: APPLICATION_ROLE_METADATA_BY_ID.trainer,
  MANAGER: APPLICATION_ROLE_METADATA_BY_ID.manager,
  STORE: APPLICATION_ROLE_METADATA_BY_ID.store,
  THERAPIST: APPLICATION_ROLE_METADATA_BY_ID.therapist,
});

export const ALL_MENU_ITEMS = [
  { id: "dashboard", label: "營運總覽", icon: LayoutDashboard },
  { id: "daily", label: "每日分析", icon: Calendar, roles: ["director", "trainer", "manager"] },
  { id: "annual", label: "年度分析", icon: Calendar },
  { id: "targets", label: "年度設定", icon: Target }, 
  { id: "regional", label: "區域分析", icon: MapIcon },
  { id: "store-analysis", label: "單店分析", icon: Store },
  { id: "ranking", label: "詳細報表", icon: TrendingUp },
  { id: "audit", label: "回報檢核", icon: ClipboardCheck },
  { id: "history", label: "業績修正", icon: FileText },
  { id: "input", label: "日報輸入", icon: Upload },
  { id: "logs", label: "登入監控", icon: Activity },
  { id: "notification", label: "推播管理", icon: Bell, roles: ["director", "master"] }, // 🔔 新增的推播控制中心選單
  { id: "t-targets", label: "管師目標", icon: UserCog, requiresTherapistModule: true }, 
  { id: "t-schedule", label: "管師排休", icon: CalendarOff, requiresTherapistModule: true },
  { id: "store-schedule", label: "店家排休", icon: Store },
  { id: "therapist-manager", label: "管師帳號", icon: Users, roles: ["director", "trainer", "manager"], requiresTherapistModule: true },
  { id: "smart-forecast", label: "智慧推估", icon: Sparkles },
  { id: "settings", label: "系統設定", icon: Settings },
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
  
  // 教專權限
  trainer: ["dashboard", "ranking", "audit", "settings", "t-targets", "t-schedule", "therapist-manager"],

  manager: ["dashboard", "annual", "targets", "regional", "store-analysis", "audit", "t-targets", "t-schedule"],
  store: ["dashboard", "annual", "targets", "store-analysis", "ranking", "history", "input", "t-targets", "t-schedule"],
  therapist: ["dashboard", "input"],
};

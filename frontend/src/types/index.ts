// ==================== Core Entity Types ====================

export interface Unit {
  id: string;
  name: string;
  code: string;
  desc: string;
  ip_ranges: string[];
  aliases: string[];
  keywords: string[];
  contact: string;
  email: string;
  status: 'active' | 'inactive';
  region: string;
  region_name: string;
  last_sync: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  name: string;
  ip: string;
  mac: string;
  type: string;
  os: string;
  risk: '严重' | '高危' | '中危' | '低危';
  unit_id: string | null;
  vuln_ids: string[];
  ports: string;
  services: string;
  location: string;
  isp: string;
  raw_data: Record<string, unknown>[];
  last_seen: string | null;
  created_at?: string | null;
}

export interface AssetChange {
  id: string;
  asset_id: string;
  unit_id: string | null;
  ip: string;
  source: string;
  action: 'create' | 'update' | string;
  changes: Record<string, unknown>;
  created_at: string;
}

export interface Vulnerability {
  id: string;
  title: string;
  cve: string;
  poc: string;
  cvss: number;
  severity: '严重' | '高危' | '中危' | '低危';
  asset_ids: string[];
  desc: string;
  solution: string;
  status: '待确认' | '待整改' | '整改中' | '待复测' | '已修复' | '误报' | '接受风险';
  status_note: string;
  status_updated_at: string | null;
  first_found: string | null;
  last_found: string | null;
  created_at?: string | null;
}

export interface Report {
  id: string;
  title: string;
  type: string;
  format: 'docx' | 'xlsx' | 'html';
  unit_id: string | null;
  unit_name?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  status: 'completed' | 'processing' | 'failed';
  created_at: string | null;
}

export interface Template {
  id: string;
  name: string;
  desc: string;
  content: string;
  type: string;
  vars: string[];
  source: 'system' | 'user';
  has_file?: boolean;
  updated_at?: string | null;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'super_admin' | 'operator' | 'auditor';
  email: string;
  status: 'active' | 'disabled';
  last_login: string | null;
  created_at?: string | null;
}

// ==================== API Types ====================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface UnitStats {
  asset_count: number;
  vuln_count: number;
  critical_vuln: number;
  high_vuln: number;
}

export interface DashboardData {
  total_assets: number;
  total_units: number;
  total_vulns: number;
  critical_high: number;
  pending_critical?: number;
  top_risk_units?: (Unit & UnitStats & { score: number })[];
}

export interface SyncTask {
  id: string;
  unit_id: string | null;
  unit_name?: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message: string;
  query_condition: string;
  fetched_assets: number;
  synced_assets: number;
  synced_vulns: number;
  error_detail: string;
  duration_seconds?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SyncTaskSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  success_rate: number;
  recent_failed: SyncTask[];
}

export interface AssetQualityIssue {
  key: string;
  label: string;
  count: number;
  rate: number;
  samples: { id: string; ip: string; name: string; unit_id: string | null; issue: string }[];
}

export interface AssetQualityReport {
  total_assets: number;
  assigned_assets: number;
  unassigned_assets: number;
  assigned_rate: number;
  duplicate_group_count: number;
  duplicate_groups: { unit_id: string | null; ip: string; count: number }[];
  raw_org_non_empty: number;
  raw_org_empty: number;
  raw_org_domain_like: number;
  issues: AssetQualityIssue[];
}

export interface SyncScheduleUnit {
  unit_id: string;
  unit_name: string;
  unit_status: 'active' | 'inactive';
  last_sync: string | null;
  next_sync: string | null;
  due: boolean;
  active_task_id: string;
  active_task_status: string;
  last_task_status: string;
  last_task_message: string;
  last_task_updated_at: string | null;
}

export interface SyncSchedule {
  sync_enabled: boolean;
  sync_interval_minutes: number;
  now: string;
  units: SyncScheduleUnit[];
}

export interface AuditLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  target_type: string;
  target_id: string;
  target_name: string;
  result: 'success' | 'failed';
  ip: string;
  user_agent: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface DeepHealth {
  status: 'ok' | 'degraded';
  app: string;
  checks: Record<string, { ok: boolean; message: string; [key: string]: unknown }>;
}

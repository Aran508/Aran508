export type Role = 'operator' | 'supervisor' | 'management' | 'admin';

export const ROLE_LABEL: Record<Role, string> = {
  operator: 'Data Entry Operator',
  supervisor: 'Production Supervisor',
  management: 'Management / HOD',
  admin: 'Administrator',
};

export type Permission =
  | 'entry.create'
  | 'entry.edit_own'
  | 'entry.edit_any'
  | 'entry.verify'
  | 'entry.delete'
  | 'entry.override_times'
  | 'reports.view'
  | 'records.view_all'
  | 'master.edit'
  | 'users.manage'
  | 'audit.view'
  | 'import.run';

const MATRIX: Record<Role, Permission[]> = {
  operator: ['entry.create', 'entry.edit_own'],
  supervisor: ['entry.create', 'entry.edit_own', 'entry.edit_any', 'entry.verify', 'entry.override_times', 'reports.view', 'records.view_all', 'audit.view'],
  management: ['reports.view', 'records.view_all', 'audit.view'],
  admin: ['entry.create', 'entry.edit_own', 'entry.edit_any', 'entry.verify', 'entry.delete', 'entry.override_times', 'reports.view', 'records.view_all', 'master.edit', 'users.manage', 'audit.view', 'import.run'],
};

export const can = (role: Role | undefined | null, p: Permission) => !!role && MATRIX[role].includes(p);
export const PERMISSION_MATRIX = MATRIX;

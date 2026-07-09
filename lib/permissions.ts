export const ROLE_LABELS = {
  admin: "系统管理员",
  manager: "物料管理员",
  user: "普通用户",
  readonly: "只读用户",
} as const;

export type UserRole = keyof typeof ROLE_LABELS;

export type Permission =
  | "inventory:read"
  | "inventory:write"
  | "inventory:delete"
  | "usage:create"
  | "reservation:create"
  | "reservation:process"
  | "reservation:delete"
  | "backup:run"
  | "users:manage"
  | "demo:reset";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "inventory:read",
    "inventory:write",
    "inventory:delete",
    "usage:create",
    "reservation:create",
    "reservation:process",
    "reservation:delete",
    "backup:run",
    "users:manage",
    "demo:reset",
  ],
  manager: [
    "inventory:read",
    "inventory:write",
    "inventory:delete",
    "usage:create",
    "reservation:create",
    "reservation:process",
    "reservation:delete",
  ],
  user: ["inventory:read", "usage:create", "reservation:create"],
  readonly: ["inventory:read"],
};

export function isUserRole(value: string): value is UserRole {
  return value in ROLE_LABELS;
}

export function getPermissions(role: UserRole) {
  return ROLE_PERMISSIONS[role];
}

export function can(role: UserRole, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}

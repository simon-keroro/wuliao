import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  initialMaterials,
  initialUsage,
  type AuditLog,
  type CurrentUser,
  type InventoryState,
  type MaterialBatch,
  type MaterialInput,
  type MaterialUpdateInput,
  type PasswordChangeInput,
  type PublicUser,
  type ReservationInput,
  type ReservationRecord,
  type UserInput,
  type UserUpdateInput,
  type UsageInput,
  type UsageRecord,
} from "@/lib/materials";
import { getPermissions, isUserRole, type UserRole } from "@/lib/permissions";
import { hashPassword, verifyPassword } from "@/lib/server/password";

type MaterialRow = {
  id: string;
  sap_no: string;
  name: string;
  category: string;
  specification: string;
  unit: string;
  batch_no: string;
  supplier: string;
  storage_location: string;
  received_date: string;
  expiry_date: string;
  initial_quantity: number;
  remaining_quantity: number;
  min_quantity: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

type UsageRow = {
  id: string;
  material_batch_id: string;
  sap_no: string;
  material_name: string;
  batch_no: string;
  user_name: string;
  used_date: string;
  used_quantity: number;
  purpose: string;
  notes: string;
  created_at: string;
};

type ReservationRow = {
  id: string;
  requester: string;
  sap_no: string;
  material_name: string;
  unit: string;
  quantity: number;
  expected_date: string;
  received_at: string;
  received_batch_id: string;
  created_at: string;
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

type AuditLogRow = {
  id: string;
  user_id: string;
  username: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
};

let cachedDb: DatabaseSync | null = null;

function getDatabasePath() {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "materials.sqlite");
}

function ensureParentDirectory(filePath: string) {
  const directory = path.dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function getDatabase() {
  if (cachedDb) return cachedDb;

  const databasePath = getDatabasePath();
  ensureParentDirectory(databasePath);

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      sap_no TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      specification TEXT NOT NULL,
      unit TEXT NOT NULL,
      batch_no TEXT NOT NULL,
      supplier TEXT NOT NULL,
      storage_location TEXT NOT NULL,
      received_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      initial_quantity REAL NOT NULL,
      remaining_quantity REAL NOT NULL,
      min_quantity REAL NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      material_batch_id TEXT NOT NULL,
      sap_no TEXT NOT NULL,
      material_name TEXT NOT NULL,
      batch_no TEXT NOT NULL,
      user_name TEXT NOT NULL,
      used_date TEXT NOT NULL,
      used_quantity REAL NOT NULL,
      purpose TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (material_batch_id) REFERENCES materials(id)
    );

    CREATE TABLE IF NOT EXISTS reservation_records (
      id TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      sap_no TEXT NOT NULL,
      material_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      expected_date TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT '',
      received_batch_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS usage_records_created_at_idx
      ON usage_records(created_at DESC);

    CREATE INDEX IF NOT EXISTS reservation_records_expected_date_idx
      ON reservation_records(expected_date ASC, created_at DESC);

    CREATE INDEX IF NOT EXISTS users_username_idx
      ON users(username);

    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
      ON audit_logs(created_at DESC);
  `);
  ensureColumn(db, "materials", "sap_no", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "usage_records", "sap_no", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "reservation_records", "received_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "reservation_records", "received_batch_id", "TEXT NOT NULL DEFAULT ''");

  cachedDb = db;
  seedAdminUserIfEmpty(db);
  seedDatabaseIfEmpty(db);
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
}

function requiredBootstrapPassword() {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.APP_PASSWORD || "";
  if (!password) {
    throw new Error("服务器尚未设置 BOOTSTRAP_ADMIN_PASSWORD 或 APP_PASSWORD，不能创建初始管理员。");
  }
  return password;
}

function seedAdminUserIfEmpty(db: DatabaseSync) {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (userCount.count > 0) return;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, role, enabled, created_at, updated_at, last_login_at
    )
    VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, '')
  `).run(
    `user-${randomUUID()}`,
    requiredText(process.env.BOOTSTRAP_ADMIN_USERNAME) || "admin",
    requiredText(process.env.BOOTSTRAP_ADMIN_NAME) || "系统管理员",
    hashPassword(requiredBootstrapPassword()),
    now,
    now,
  );
}

function seedDatabaseIfEmpty(db: DatabaseSync) {
  const materialCount = db.prepare("SELECT COUNT(*) AS count FROM materials").get() as { count: number };
  const usageCount = db.prepare("SELECT COUNT(*) AS count FROM usage_records").get() as { count: number };
  if (materialCount.count > 0 || usageCount.count > 0) return;
  resetDemoData(db);
}

function userFromRow(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: isUserRole(row.role) ? row.role : "readonly",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function currentUserFromRow(row: UserRow): CurrentUser {
  const user = userFromRow(row);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: getPermissions(user.role),
  };
}

function auditLogFromRow(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action,
    target: row.target,
    details: row.details,
    createdAt: row.created_at,
  };
}

function materialFromRow(row: MaterialRow): MaterialBatch {
  return {
    id: row.id,
    sapNo: row.sap_no,
    name: row.name,
    category: row.category,
    specification: row.specification,
    unit: row.unit,
    batchNo: row.batch_no,
    supplier: row.supplier,
    storageLocation: row.storage_location,
    receivedDate: row.received_date,
    expiryDate: row.expiry_date,
    initialQuantity: row.initial_quantity,
    remainingQuantity: row.remaining_quantity,
    minQuantity: row.min_quantity,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function usageFromRow(row: UsageRow): UsageRecord {
  return {
    id: row.id,
    materialBatchId: row.material_batch_id,
    sapNo: row.sap_no,
    materialName: row.material_name,
    batchNo: row.batch_no,
    userName: row.user_name,
    usedDate: row.used_date,
    usedQuantity: row.used_quantity,
    purpose: row.purpose,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function reservationFromRow(row: ReservationRow): ReservationRecord {
  return {
    id: row.id,
    requester: row.requester,
    sapNo: row.sap_no,
    materialName: row.material_name,
    unit: row.unit,
    quantity: row.quantity,
    expectedDate: row.expected_date,
    receivedAt: row.received_at,
    receivedBatchId: row.received_batch_id,
    createdAt: row.created_at,
  };
}

function insertMaterial(db: DatabaseSync, batch: MaterialBatch) {
  db.prepare(`
    INSERT INTO materials (
      id, sap_no, name, category, specification, unit, batch_no, supplier, storage_location,
      received_date, expiry_date, initial_quantity, remaining_quantity, min_quantity,
      notes, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batch.id,
    batch.sapNo,
    batch.name,
    batch.category,
    batch.specification,
    batch.unit,
    batch.batchNo,
    batch.supplier,
    batch.storageLocation,
    batch.receivedDate,
    batch.expiryDate,
    batch.initialQuantity,
    batch.remainingQuantity,
    batch.minQuantity,
    batch.notes,
    batch.createdAt,
    batch.updatedAt,
  );
}

function insertUsage(db: DatabaseSync, record: UsageRecord) {
  db.prepare(`
    INSERT INTO usage_records (
      id, material_batch_id, sap_no, material_name, batch_no, user_name,
      used_date, used_quantity, purpose, notes, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.materialBatchId,
    record.sapNo,
    record.materialName,
    record.batchNo,
    record.userName,
    record.usedDate,
    record.usedQuantity,
    record.purpose,
    record.notes,
    record.createdAt,
  );
}

function insertReservation(db: DatabaseSync, record: ReservationRecord) {
  db.prepare(`
    INSERT INTO reservation_records (
      id, requester, sap_no, material_name, unit, quantity, expected_date,
      received_at, received_batch_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.requester,
    record.sapNo,
    record.materialName,
    record.unit,
    record.quantity,
    record.expectedDate,
    record.receivedAt,
    record.receivedBatchId,
    record.createdAt,
  );
}

function updateMaterialRow(db: DatabaseSync, batch: MaterialBatch) {
  db.prepare(`
    UPDATE materials
    SET sap_no = ?, name = ?, category = ?, specification = ?, unit = ?,
      batch_no = ?, supplier = ?, storage_location = ?, received_date = ?,
      expiry_date = ?, initial_quantity = ?, remaining_quantity = ?,
      min_quantity = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    batch.sapNo,
    batch.name,
    batch.category,
    batch.specification,
    batch.unit,
    batch.batchNo,
    batch.supplier,
    batch.storageLocation,
    batch.receivedDate,
    batch.expiryDate,
    batch.initialQuantity,
    batch.remainingQuantity,
    batch.minQuantity,
    batch.notes,
    batch.updatedAt,
    batch.id,
  );
}

function resetDemoData(db = getDatabase()) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec("DELETE FROM reservation_records;");
    db.exec("DELETE FROM usage_records;");
    db.exec("DELETE FROM materials;");
    for (const batch of initialMaterials) insertMaterial(db, batch);
    for (const record of initialUsage) insertUsage(db, record);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function isEightDigitSapNo(value: string) {
  return /^\d{8}$/.test(value);
}

function positiveNumber(value: string | number | undefined) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NaN;
}

function requiredText(value: string | undefined) {
  return value?.trim() ?? "";
}

function validateMaterialInput(input: MaterialInput) {
  const quantity = positiveNumber(input.initialQuantity);
  const minQuantity = positiveNumber(input.minQuantity ?? 0);
  const sapNo = requiredText(input.sapNo);
  const name = requiredText(input.name);

  if (sapNo && !isEightDigitSapNo(sapNo)) {
    throw new Error("SAP号必须是 8 位数字。");
  }
  if (!name || quantity <= 0) {
    throw new Error("请填写物料名称，并填写大于 0 的入库数量。");
  }

  return {
    quantity,
    minQuantity: Number.isFinite(minQuantity) ? minQuantity : 0,
    sapNo,
    name,
  };
}

function daysUntil(dateValue: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function findReceivedBatchId(db: DatabaseSync, reservation: ReservationRow) {
  if (reservation.received_batch_id) return reservation.received_batch_id;
  if (!reservation.received_at) return "";

  const row = db
    .prepare(
      `
        SELECT id FROM materials
        WHERE created_at = ?
          AND sap_no = ?
          AND name = ?
          AND unit = ?
          AND initial_quantity = ?
          AND supplier = '仓储部'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(
      reservation.received_at,
      reservation.sap_no,
      reservation.material_name,
      reservation.unit,
      reservation.quantity,
    ) as { id: string } | undefined;

  return row?.id ?? "";
}

function ensureRole(role: string | undefined): UserRole {
  if (role && isUserRole(role)) return role;
  throw new Error("请选择有效的用户角色。");
}

function ensureCanChangeAdmin(db: DatabaseSync, id: string, nextRole?: UserRole, nextEnabled?: boolean) {
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!current) throw new Error("用户不存在。");
  if (current.role !== "admin") return;

  const activeAdminCount = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1")
    .get() as { count: number };
  const willRemainActiveAdmin = (nextRole ?? current.role) === "admin" && (nextEnabled ?? Boolean(current.enabled));
  if (activeAdminCount.count <= 1 && !willRemainActiveAdmin) {
    throw new Error("不能停用或降级最后一个系统管理员。");
  }
}

export function authenticateUser(username: string, password: string): CurrentUser | null {
  const db = getDatabase();
  const normalizedUsername = requiredText(username);
  if (!normalizedUsername || !password) return null;

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(normalizedUsername) as UserRow | undefined;
  if (!row || !row.enabled || !verifyPassword(password, row.password_hash)) return null;

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id) as UserRow;
  const user = currentUserFromRow(updated);
  logAudit(user, "auth.login", user.username, {});
  return user;
}

export function getCurrentUserById(userId: string): CurrentUser | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!row || !row.enabled) return null;
  return currentUserFromRow(row);
}

export function listUsers(): PublicUser[] {
  const db = getDatabase();
  return (db.prepare("SELECT * FROM users ORDER BY role ASC, username ASC").all() as UserRow[]).map(userFromRow);
}

export function createUser(input: UserInput, actor: CurrentUser): PublicUser[] {
  const username = requiredText(input.username);
  const displayName = requiredText(input.displayName) || username;
  const password = input.password ?? "";
  const role = ensureRole(input.role);
  if (!username || !/^[A-Za-z0-9._-]{2,40}$/.test(username)) {
    throw new Error("用户名需为 2-40 位字母、数字、点、下划线或短横线。");
  }
  if (password.length < 6) throw new Error("用户密码至少需要 6 位。");

  const db = getDatabase();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO users (
        id, username, display_name, password_hash, role, enabled, created_at, updated_at, last_login_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, '')
    `).run(`user-${randomUUID()}`, username, displayName, hashPassword(password), role, now, now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new Error("用户名已存在。");
    }
    throw error;
  }
  logAudit(actor, "user.create", username, { role });
  return listUsers();
}

export function updateUser(input: UserUpdateInput, actor: CurrentUser): PublicUser[] {
  const db = getDatabase();
  const id = requiredText(input.id);
  if (!id) throw new Error("缺少要修改的用户。");

  const role = input.role ? ensureRole(input.role) : undefined;
  const enabled = typeof input.enabled === "boolean" ? input.enabled : undefined;
  ensureCanChangeAdmin(db, id, role, enabled);

  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  if (!current) throw new Error("用户不存在。");

  const nextDisplayName = requiredText(input.displayName) || current.display_name;
  const nextRole = role ?? (isUserRole(current.role) ? current.role : "readonly");
  const nextEnabled = enabled ?? Boolean(current.enabled);
  const now = new Date().toISOString();

  db.prepare("UPDATE users SET display_name = ?, role = ?, enabled = ?, updated_at = ? WHERE id = ?").run(
    nextDisplayName,
    nextRole,
    nextEnabled ? 1 : 0,
    now,
    id,
  );
  logAudit(actor, "user.update", current.username, { role: nextRole, enabled: nextEnabled });
  return listUsers();
}

export function resetUserPassword(id: string, password: string, actor: CurrentUser): PublicUser[] {
  if (password.length < 6) throw new Error("新密码至少需要 6 位。");
  const db = getDatabase();
  const userId = requiredText(id);
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!current) throw new Error("用户不存在。");

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), now, userId);
  logAudit(actor, "user.password.reset", current.username, {});
  return listUsers();
}

export function changeOwnPassword(input: PasswordChangeInput, actor: CurrentUser): CurrentUser {
  const currentPassword = input.currentPassword ?? "";
  const newPassword = input.newPassword ?? "";
  if (!currentPassword) throw new Error("请输入当前密码。");
  if (newPassword.length < 6) throw new Error("新密码至少需要 6 位。");

  const db = getDatabase();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(actor.id) as UserRow | undefined;
  if (!row || !row.enabled) throw new Error("当前账号不存在或已停用。");
  if (!verifyPassword(currentPassword, row.password_hash)) throw new Error("当前密码不正确。");

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(newPassword), now, actor.id);
  logAudit(actor, "user.password.change", actor.username, {});
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(actor.id) as UserRow;
  return currentUserFromRow(updated);
}

export function listAuditLogs(actor: CurrentUser, includeAllUsers: boolean): AuditLog[] {
  const db = getDatabase();
  const rows = includeAllUsers
    ? (db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 500").all() as AuditLogRow[])
    : (db
        .prepare("SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 500")
        .all(actor.id) as AuditLogRow[]);
  return rows.map(auditLogFromRow);
}

export function logAudit(user: CurrentUser, action: string, target: string, details: Record<string, unknown>) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, username, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit-${randomUUID()}`,
    user.id,
    user.username,
    action,
    target,
    JSON.stringify(details),
    new Date().toISOString(),
  );
}

export function getInventoryState(): InventoryState {
  const db = getDatabase();
  const materials = (db.prepare("SELECT * FROM materials ORDER BY created_at DESC, id DESC").all() as MaterialRow[]).map(
    materialFromRow,
  );
  const usageRecords = (
    db.prepare("SELECT * FROM usage_records ORDER BY created_at DESC, id DESC").all() as UsageRow[]
  ).map(usageFromRow);
  const reservationRecords = (
    db.prepare("SELECT * FROM reservation_records ORDER BY expected_date ASC, created_at DESC").all() as ReservationRow[]
  ).map(reservationFromRow);
  return { materials, usageRecords, reservationRecords };
}

export function createMaterial(input: MaterialInput): InventoryState {
  const { quantity, minQuantity, sapNo, name } = validateMaterialInput(input);
  const batchNo = requiredText(input.batchNo);
  const unit = requiredText(input.unit);
  const expiryDate = requiredText(input.expiryDate);

  const now = new Date().toISOString();
  const batch: MaterialBatch = {
    id: `batch-${randomUUID()}`,
    sapNo,
    name,
    category: requiredText(input.category) || "未分类",
    specification: requiredText(input.specification),
    unit,
    batchNo,
    supplier: requiredText(input.supplier),
    storageLocation: requiredText(input.storageLocation),
    receivedDate: requiredText(input.receivedDate) || now.slice(0, 10),
    expiryDate,
    initialQuantity: quantity,
    remainingQuantity: quantity,
    minQuantity,
    notes: requiredText(input.notes),
    createdAt: now,
    updatedAt: now,
  };

  insertMaterial(getDatabase(), batch);
  return getInventoryState();
}

export function updateMaterial(input: MaterialUpdateInput): InventoryState {
  const db = getDatabase();
  const id = requiredText(input.id);
  if (!id) throw new Error("缺少要编辑的库存批次。");

  const current = db.prepare("SELECT * FROM materials WHERE id = ?").get(id) as MaterialRow | undefined;
  if (!current) throw new Error("所选库存批次不存在，请刷新页面后重试。");

  const { quantity, minQuantity, sapNo, name } = validateMaterialInput(input);
  const consumedQuantity = Math.max(0, current.initial_quantity - current.remaining_quantity);
  const remainingQuantity = Math.max(0, quantity - consumedQuantity);
  const now = new Date().toISOString();

  const batch: MaterialBatch = {
    id: current.id,
    sapNo,
    name,
    category: requiredText(input.category) || "未分类",
    specification: requiredText(input.specification),
    unit: requiredText(input.unit),
    batchNo: requiredText(input.batchNo),
    supplier: requiredText(input.supplier),
    storageLocation: requiredText(input.storageLocation),
    receivedDate: requiredText(input.receivedDate) || now.slice(0, 10),
    expiryDate: requiredText(input.expiryDate),
    initialQuantity: quantity,
    remainingQuantity,
    minQuantity,
    notes: requiredText(input.notes),
    createdAt: current.created_at,
    updatedAt: now,
  };

  updateMaterialRow(db, batch);
  return getInventoryState();
}

export function deleteMaterial(materialBatchId: string): InventoryState {
  const db = getDatabase();
  const id = requiredText(materialBatchId);
  if (!id) throw new Error("缺少要删除的库存批次。");

  db.exec("BEGIN IMMEDIATE;");
  try {
    const current = db.prepare("SELECT * FROM materials WHERE id = ?").get(id) as MaterialRow | undefined;
    if (!current) throw new Error("所选库存批次不存在，请刷新页面后重试。");

    db.prepare("DELETE FROM usage_records WHERE material_batch_id = ?").run(id);
    db.prepare("DELETE FROM materials WHERE id = ?").run(id);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return getInventoryState();
}

export function createUsageRecord(input: UsageInput): InventoryState {
  const db = getDatabase();
  const materialBatchId = requiredText(input.materialBatchId);
  const userName = requiredText(input.userName);
  const usedDate = requiredText(input.usedDate);
  const usedQuantity = positiveNumber(input.usedQuantity);
  if (!materialBatchId || !userName || !usedDate || usedQuantity <= 0) {
    throw new Error("请选择可领用批次，并填写领用人、日期和大于 0 的领用量。");
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    const batch = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialBatchId) as MaterialRow | undefined;
    if (!batch) throw new Error("所选批次不存在，请刷新页面后重试。");
    if (daysUntil(batch.expiry_date) < 0) throw new Error("该批次已过期，不能领用。");
    if (usedQuantity > batch.remaining_quantity) {
      throw new Error(`领用量超过库存。当前可用 ${batch.remaining_quantity} ${batch.unit}。`);
    }

    const now = new Date().toISOString();
    const record: UsageRecord = {
      id: `usage-${randomUUID()}`,
      materialBatchId: batch.id,
      sapNo: batch.sap_no,
      materialName: batch.name,
      batchNo: batch.batch_no,
      userName,
      usedDate,
      usedQuantity,
      purpose: requiredText(input.purpose),
      notes: requiredText(input.notes),
      createdAt: now,
    };

    insertUsage(db, record);
    db.prepare("UPDATE materials SET remaining_quantity = remaining_quantity - ?, updated_at = ? WHERE id = ?").run(
      usedQuantity,
      now,
      batch.id,
    );
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return getInventoryState();
}

export function createReservation(input: ReservationInput): InventoryState {
  const requester = requiredText(input.requester);
  const sapNo = requiredText(input.sapNo);
  const materialName = requiredText(input.materialName);
  const unit = requiredText(input.unit);
  const quantity = positiveNumber(input.quantity);
  const expectedDate = requiredText(input.expectedDate);

  if (!materialName || quantity <= 0) {
    throw new Error("请填写物料名称，并填写大于 0 的数量。");
  }
  if (sapNo && !isEightDigitSapNo(sapNo)) {
    throw new Error("SAP号必须是 8 位数字。");
  }

  const record: ReservationRecord = {
    id: `reservation-${randomUUID()}`,
    requester,
    sapNo,
    materialName,
    unit,
    quantity,
    expectedDate,
    receivedAt: "",
    receivedBatchId: "",
    createdAt: new Date().toISOString(),
  };
  insertReservation(getDatabase(), record);
  return getInventoryState();
}

export function receiveReservation(reservationId: string): InventoryState {
  const db = getDatabase();
  const id = requiredText(reservationId);
  if (!id) throw new Error("缺少要确认领取的预约记录。");

  db.exec("BEGIN IMMEDIATE;");
  try {
    const reservation = db.prepare("SELECT * FROM reservation_records WHERE id = ?").get(id) as
      | ReservationRow
      | undefined;
    if (!reservation) throw new Error("所选预约记录不存在，请刷新页面后重试。");
    if (reservation.received_at) {
      db.exec("COMMIT;");
      return getInventoryState();
    }

    const template = (
      reservation.sap_no
        ? db
            .prepare("SELECT * FROM materials WHERE sap_no = ? ORDER BY created_at DESC, id DESC LIMIT 1")
            .get(reservation.sap_no)
        : db
            .prepare("SELECT * FROM materials WHERE name = ? ORDER BY created_at DESC, id DESC LIMIT 1")
            .get(reservation.material_name)
    ) as MaterialRow | undefined;
    const now = new Date().toISOString();
    const batchId = `batch-${randomUUID()}`;
    const batch: MaterialBatch = {
      id: batchId,
      sapNo: reservation.sap_no,
      name: reservation.material_name,
      category: template?.category || "未分类",
      specification: template?.specification || "",
      unit: reservation.unit,
      batchNo: "",
      supplier: "仓储部",
      storageLocation: template?.storage_location || "科研开放部待分配",
      receivedDate: now.slice(0, 10),
      expiryDate: "",
      initialQuantity: reservation.quantity,
      remainingQuantity: reservation.quantity,
      minQuantity: template?.min_quantity ?? 0,
      notes: reservation.requester ? `由 ${reservation.requester} 预约，从仓储领取。` : "从仓储领取。",
      createdAt: now,
      updatedAt: now,
    };

    insertMaterial(db, batch);
    db.prepare("UPDATE reservation_records SET received_at = ?, received_batch_id = ? WHERE id = ?").run(
      now,
      batchId,
      id,
    );
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return getInventoryState();
}

export function undoReceiveReservation(reservationId: string): InventoryState {
  const db = getDatabase();
  const id = requiredText(reservationId);
  if (!id) throw new Error("缺少要撤销的预约记录。");

  db.exec("BEGIN IMMEDIATE;");
  try {
    const reservation = db.prepare("SELECT * FROM reservation_records WHERE id = ?").get(id) as
      | ReservationRow
      | undefined;
    if (!reservation) throw new Error("所选预约记录不存在，请刷新页面后重试。");
    if (!reservation.received_at) {
      db.exec("COMMIT;");
      return getInventoryState();
    }

    const batchId = findReceivedBatchId(db, reservation);
    if (!batchId) throw new Error("找不到该预约自动生成的入库批次，无法撤销。");

    const usageCount = db
      .prepare("SELECT COUNT(*) AS count FROM usage_records WHERE material_batch_id = ?")
      .get(batchId) as { count: number };
    if (usageCount.count > 0) {
      throw new Error("该入库批次已有领用记录，不能撤销入研发库。");
    }

    db.prepare("DELETE FROM materials WHERE id = ?").run(batchId);
    db.prepare("UPDATE reservation_records SET received_at = '', received_batch_id = '' WHERE id = ?").run(id);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return getInventoryState();
}

export function deleteReservation(reservationId: string): InventoryState {
  const db = getDatabase();
  const id = requiredText(reservationId);
  if (!id) throw new Error("缺少要删除的预约记录。");

  const result = db.prepare("DELETE FROM reservation_records WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("所选预约记录不存在，请刷新页面后重试。");

  return getInventoryState();
}

export function restoreDemoState(): InventoryState {
  resetDemoData();
  return getInventoryState();
}

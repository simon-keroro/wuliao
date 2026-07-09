import type { Permission, UserRole } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: Permission[];
};

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type AuditLog = {
  id: string;
  userId: string;
  username: string;
  action: string;
  target: string;
  details: string;
  createdAt: string;
};

export type UserInput = {
  username?: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
};

export type UserUpdateInput = {
  id?: string;
  displayName?: string;
  role?: UserRole;
  enabled?: boolean;
};

export type PasswordChangeInput = {
  currentPassword?: string;
  newPassword?: string;
};

export type MaterialBatch = {
  id: string;
  sapNo: string;
  name: string;
  category: string;
  specification: string;
  unit: string;
  batchNo: string;
  supplier: string;
  storageLocation: string;
  receivedDate: string;
  expiryDate: string;
  initialQuantity: number;
  remainingQuantity: number;
  minQuantity: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type UsageRecord = {
  id: string;
  materialBatchId: string;
  sapNo: string;
  materialName: string;
  batchNo: string;
  userName: string;
  usedDate: string;
  usedQuantity: number;
  purpose: string;
  notes: string;
  createdAt: string;
};

export type ReservationRecord = {
  id: string;
  requester: string;
  sapNo: string;
  materialName: string;
  unit: string;
  quantity: number;
  expectedDate: string;
  receivedAt: string;
  receivedBatchId: string;
  createdAt: string;
};

export type InventoryState = {
  materials: MaterialBatch[];
  usageRecords: UsageRecord[];
  reservationRecords: ReservationRecord[];
};

export type MaterialInput = {
  sapNo?: string;
  name?: string;
  category?: string;
  specification?: string;
  unit?: string;
  batchNo?: string;
  supplier?: string;
  storageLocation?: string;
  receivedDate?: string;
  expiryDate?: string;
  initialQuantity?: string | number;
  minQuantity?: string | number;
  notes?: string;
};

export type MaterialUpdateInput = MaterialInput & {
  id?: string;
};

export type UsageInput = {
  materialBatchId?: string;
  userName?: string;
  usedDate?: string;
  usedQuantity?: string | number;
  purpose?: string;
  notes?: string;
};

export type ReservationInput = {
  requester?: string;
  sapNo?: string;
  materialName?: string;
  unit?: string;
  quantity?: string | number;
  expectedDate?: string;
};

export const initialMaterials: MaterialBatch[] = [
  {
    id: "batch-ethanol-001",
    sapNo: "10000001",
    name: "无水乙醇",
    category: "试剂",
    specification: "500 mL/瓶",
    unit: "瓶",
    batchNo: "ET20260601",
    supplier: "国药试剂",
    storageLocation: "试剂柜 A-02",
    receivedDate: "2026-06-01",
    expiryDate: "2026-08-15",
    initialQuantity: 12,
    remainingQuantity: 8,
    minQuantity: 3,
    notes: "易燃，避光保存",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-18T09:00:00.000Z",
  },
  {
    id: "batch-tip-001",
    sapNo: "10000002",
    name: "移液枪吸头",
    category: "耗材",
    specification: "200 uL，96支/盒",
    unit: "盒",
    batchNo: "TIP2605",
    supplier: "Axygen",
    storageLocation: "耗材架 B-01",
    receivedDate: "2026-05-20",
    expiryDate: "2028-05-20",
    initialQuantity: 40,
    remainingQuantity: 6,
    minQuantity: 8,
    notes: "无菌盒装",
    createdAt: "2026-05-20T09:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
  },
  {
    id: "batch-buffer-001",
    sapNo: "10000003",
    name: "PBS缓冲液",
    category: "试剂",
    specification: "1 L/瓶",
    unit: "瓶",
    batchNo: "PBS2604",
    supplier: "实验室自配",
    storageLocation: "4C冰箱 2层",
    receivedDate: "2026-04-18",
    expiryDate: "2026-06-20",
    initialQuantity: 5,
    remainingQuantity: 2,
    minQuantity: 1,
    notes: "已过期，仅保留记录",
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
  },
];

export const initialUsage: UsageRecord[] = [
  {
    id: "usage-001",
    materialBatchId: "batch-ethanol-001",
    sapNo: "10000001",
    materialName: "无水乙醇",
    batchNo: "ET20260601",
    userName: "王珂",
    usedDate: "2026-06-18",
    usedQuantity: 4,
    purpose: "样品清洗",
    notes: "常规实验",
    createdAt: "2026-06-18T09:00:00.000Z",
  },
  {
    id: "usage-002",
    materialBatchId: "batch-tip-001",
    sapNo: "10000002",
    materialName: "移液枪吸头",
    batchNo: "TIP2605",
    userName: "李研",
    usedDate: "2026-06-12",
    usedQuantity: 34,
    purpose: "细胞培养",
    notes: "周消耗",
    createdAt: "2026-06-12T09:00:00.000Z",
  },
];

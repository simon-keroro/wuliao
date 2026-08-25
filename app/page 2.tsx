"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { InventoryState, MaterialBatch, ReservationRecord, UsageRecord } from "@/lib/materials";
import { APP_DISPLAY_TITLE } from "@/lib/version";

type Tab = "inventory" | "intake" | "usage" | "records" | "warehouseRequest" | "reservationList";
type ExpiryFilter = "all" | "normal" | "soon" | "expired";
type StockFilter = "all" | "enough" | "low" | "empty";
type ReservationSort = "oldest" | "newest";
type BulkColumnKey = "ignore" | "requester" | "sapNo" | "materialName" | "unit" | "quantity" | "expectedDate";
type ReservationDraft = {
  id: string;
  requester: string;
  sapNo: string;
  materialName: string;
  unit: string;
  quantity: string;
  expectedDate: string;
};
type BulkReservationDraft = ReservationDraft & {
  rowNumber: number;
};
type BackupResponse = {
  ok: boolean;
  sent: boolean;
  to: string;
  generatedAt: string;
};

const bulkColumnOptions: { value: BulkColumnKey; label: string }[] = [
  { value: "ignore", label: "忽略" },
  { value: "requester", label: "预约人" },
  { value: "sapNo", label: "SAP号" },
  { value: "materialName", label: "物料名称" },
  { value: "unit", label: "单位" },
  { value: "quantity", label: "数量" },
  { value: "expectedDate", label: "期望入库日期" },
];

const headerAliases: Record<Exclude<BulkColumnKey, "ignore">, string[]> = {
  requester: ["预约人", "申请人", "领用人", "提交人", "姓名"],
  sapNo: ["sap号", "sap", "物料号", "物料编码", "编码", "编号"],
  materialName: ["物料名称", "物料名", "名称", "品名", "商品名称", "物料", "耗材名称"],
  unit: ["单位", "计量单位", "包装单位"],
  quantity: ["数量", "申请数量", "预约数量", "领用数量", "需求数量", "个数"],
  expectedDate: ["期望入库日期", "入库日期", "期望日期", "预约日期", "日期", "到货日期"],
};

const commonUnits = new Set(["个", "件", "瓶", "盒", "包", "支", "袋", "套", "根", "卷", "片", "板", "箱"]);

const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;
function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const emptyMaterial = {
  sapNo: "",
  name: "",
  category: "",
  specification: "",
  unit: "",
  batchNo: "",
  supplier: "",
  storageLocation: "",
  receivedDate: getTodayDate(),
  expiryDate: "",
  initialQuantity: "",
  minQuantity: "0",
  notes: "",
};

const emptyUsage = {
  materialBatchId: "",
  userName: "",
  usedDate: getTodayDate(),
  usedQuantity: "",
  purpose: "",
  notes: "",
};

function daysUntil(dateValue: string) {
  if (!dateValue) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatWeekday(dateValue: string) {
  if (!dateValue) return "";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date(`${dateValue}T00:00:00`));
}

function normalizeCell(value: string) {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function splitPasteLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  if (line.includes(",")) return line.split(",").map((cell) => cell.trim());
  return line.trim().split(/\s+/).map((cell) => cell.trim());
}

function parseBulkPasteText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => splitPasteLine(line))
    .filter((row) => row.some(Boolean));
}

function detectHeaderColumn(cell: string): BulkColumnKey {
  const normalized = normalizeCell(cell);
  for (const [key, aliases] of Object.entries(headerAliases) as [Exclude<BulkColumnKey, "ignore">, string[]][]) {
    if (aliases.some((alias) => normalized === normalizeCell(alias))) return key;
  }
  return "ignore";
}

function isQuantityCell(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return false;
  return Number(normalized) > 0;
}

function isUnitCell(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  return commonUnits.has(normalized) || /^[a-zA-Zμu]{1,4}$/.test(normalized);
}

function normalizeDateCell(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!match) return trimmed;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isDateCell(value: string) {
  const normalized = normalizeDateCell(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  return !Number.isNaN(new Date(`${normalized}T00:00:00`).getTime());
}

function guessBulkColumn(values: string[], usedColumns: Set<BulkColumnKey>): BulkColumnKey {
  const filledValues = values.map((value) => value.trim()).filter(Boolean);
  if (filledValues.length === 0) return "ignore";

  const scores: Record<Exclude<BulkColumnKey, "ignore">, number> = {
    requester: filledValues.filter((value) => value.length >= 2 && value.length <= 8 && !isQuantityCell(value)).length * 0.75,
    sapNo: filledValues.filter((value) => /^\d{8}$/.test(value)).length * 3,
    quantity: filledValues.filter(isQuantityCell).length * 2,
    unit: filledValues.filter(isUnitCell).length * 2,
    expectedDate: filledValues.filter(isDateCell).length * 3,
    materialName: filledValues.filter((value) => value.length > 1 && !isQuantityCell(value)).length,
  };

  let bestColumn: BulkColumnKey = "ignore";
  let bestScore = 0;
  for (const [column, score] of Object.entries(scores) as [Exclude<BulkColumnKey, "ignore">, number][]) {
    if (!usedColumns.has(column) && score > bestScore) {
      bestColumn = column;
      bestScore = score;
    }
  }
  return bestScore > 0 ? bestColumn : "ignore";
}

function guessBulkColumns(rows: string[][]) {
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const usedColumns = new Set<BulkColumnKey>();
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const column = guessBulkColumn(
      rows.map((row) => row[columnIndex] ?? ""),
      usedColumns,
    );
    if (column !== "ignore") usedColumns.add(column);
    return column;
  });
}

function detectBulkColumns(rows: string[][]) {
  const columnCount = Math.max(...rows.map((row) => row.length), 0);
  const headerMapping = Array.from({ length: columnCount }, (_, index) => detectHeaderColumn(rows[0]?.[index] ?? ""));
  const headerHits = new Set(headerMapping.filter((column) => column !== "ignore")).size;
  if (headerHits >= 2) {
    return { hasHeader: true, mapping: headerMapping };
  }

  return { hasHeader: false, mapping: guessBulkColumns(rows) };
}

function getMappedCell(row: string[], mapping: BulkColumnKey[], column: BulkColumnKey) {
  const index = mapping.findIndex((item) => item === column);
  return index >= 0 ? row[index]?.trim() ?? "" : "";
}

function createReservationDraft(partial: Partial<ReservationDraft> = {}, id = `reservation-row-${Date.now()}-${Math.random()}`): ReservationDraft {
  return {
    id,
    requester: partial.requester ?? "",
    sapNo: partial.sapNo ?? "",
    materialName: partial.materialName ?? "",
    unit: partial.unit ?? "",
    quantity: partial.quantity ?? "",
    expectedDate: partial.expectedDate ?? getTodayDate(),
  };
}

function validateReservationDraft(draft: ReservationDraft) {
  const errors: string[] = [];
  if (draft.sapNo && !/^\d{8}$/.test(draft.sapNo)) errors.push("SAP号不是8位数字");
  if (!draft.materialName.trim()) errors.push("缺少物料名称");
  if (!draft.unit.trim()) errors.push("缺少单位");
  if (!isQuantityCell(draft.quantity)) errors.push("数量不是大于0的数字");
  if (!isDateCell(draft.expectedDate)) errors.push("缺少期望入库日期");
  return errors;
}

function isEmptyReservationDraft(draft: ReservationDraft) {
  return ![draft.requester, draft.sapNo, draft.materialName, draft.unit, draft.quantity].some((value) => value.trim());
}

function buildBulkReservationDrafts(rows: string[][], mapping: BulkColumnKey[], hasHeader: boolean) {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((row, index): BulkReservationDraft => {
    const expectedDate = normalizeDateCell(getMappedCell(row, mapping, "expectedDate")) || getTodayDate();
    const draft = createReservationDraft(
      {
        requester: getMappedCell(row, mapping, "requester"),
        sapNo: getMappedCell(row, mapping, "sapNo"),
        materialName: getMappedCell(row, mapping, "materialName"),
        unit: getMappedCell(row, mapping, "unit"),
        quantity: getMappedCell(row, mapping, "quantity"),
        expectedDate,
      },
      `bulk-row-${index + 1}`,
    );
    return { ...draft, rowNumber: index + 1 };
  });
}

function getExpiryStatus(batch: MaterialBatch) {
  const dayCount = daysUntil(batch.expiryDate);
  if (dayCount < 0) return { key: "expired", label: "已过期", tone: "danger" };
  if (dayCount * 1000 * 60 * 60 * 24 <= THIRTY_DAYS) {
    return { key: "soon", label: `临期 ${dayCount} 天`, tone: "warning" };
  }
  return { key: "normal", label: "正常", tone: "success" };
}

function getStockStatus(batch: MaterialBatch) {
  if (batch.remainingQuantity <= 0) return { key: "empty", label: "用尽", tone: "neutral" };
  if (batch.remainingQuantity <= batch.minQuantity) {
    return { key: "low", label: "低库存", tone: "warning" };
  }
  return { key: "enough", label: "充足", tone: "success" };
}

function exportCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(payload.error ?? "请求失败。", response.status);
  }
  return payload as T;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("inventory");
  const [materials, setMaterials] = useState<MaterialBatch[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [reservationRecords, setReservationRecords] = useState<ReservationRecord[]>([]);
  const [materialForm, setMaterialForm] = useState(() => ({ ...emptyMaterial, receivedDate: getTodayDate() }));
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [materialToDelete, setMaterialToDelete] = useState<MaterialBatch | null>(null);
  const [reservationToDelete, setReservationToDelete] = useState<ReservationRecord | null>(null);
  const [usageForm, setUsageForm] = useState(() => ({ ...emptyUsage, usedDate: getTodayDate() }));
  const [manualReservations, setManualReservations] = useState<ReservationDraft[]>(() => [
    createReservationDraft({}, "manual-row-1"),
  ]);
  const [bulkPasteText, setBulkPasteText] = useState("");
  const [bulkRows, setBulkRows] = useState<string[][]>([]);
  const [bulkColumnMapping, setBulkColumnMapping] = useState<BulkColumnKey[]>([]);
  const [bulkDrafts, setBulkDrafts] = useState<BulkReservationDraft[]>([]);
  const [bulkHasHeader, setBulkHasHeader] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [password, setPassword] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [backupDialogMessage, setBackupDialogMessage] = useState("");
  const [isBackupDialogOpen, setIsBackupDialogOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [query, setQuery] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [showZeroStockMaterials, setShowZeroStockMaterials] = useState(false);
  const [reservationSort, setReservationSort] = useState<ReservationSort>("newest");
  const [hideReceivedReservations, setHideReceivedReservations] = useState(false);
  const [message, setMessage] = useState("");

  const applyState = useCallback((state: InventoryState) => {
    setMaterials(state.materials);
    setUsageRecords(state.usageRecords);
    setReservationRecords(state.reservationRecords);
  }, []);

  const loadState = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = await requestJson<InventoryState>("/api/state");
      applyState(state);
      setIsAuthenticated(true);
      setMessage("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setIsAuthenticated(false);
        setMessage("");
      } else {
        setMessage(error instanceof Error ? error.message : "读取库存数据失败。");
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadState();
    });
  }, [loadState]);

  const usableMaterials = useMemo(
    () =>
      materials
        .filter((batch) => batch.remainingQuantity > 0 && getExpiryStatus(batch).key !== "expired")
        .sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate)),
    [materials],
  );

  const selectedBatch = materials.find((batch) => batch.id === usageForm.materialBatchId);
  const isEditingMaterial = Boolean(editingMaterialId);

  const stats = useMemo(() => {
    return {
      total: materials.length,
      soon: materials.filter((batch) => getExpiryStatus(batch).key === "soon").length,
      expired: materials.filter((batch) => getExpiryStatus(batch).key === "expired").length,
      low: materials.filter((batch) => getStockStatus(batch).key === "low").length,
    };
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return materials.filter((batch) => {
      const matchesKeyword =
        !keyword ||
        [batch.sapNo, batch.name, batch.category, batch.batchNo, batch.supplier, batch.storageLocation]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const expiryStatus = getExpiryStatus(batch).key;
      const stockStatus = getStockStatus(batch).key;
      const matchesExpiry = expiryFilter === "all" || expiryStatus === expiryFilter;
      const matchesStock = stockFilter === "all" || stockStatus === stockFilter;
      const matchesZeroStockVisibility = showZeroStockMaterials || batch.remainingQuantity > 0;
      return matchesKeyword && matchesExpiry && matchesStock && matchesZeroStockVisibility;
    });
  }, [materials, query, expiryFilter, stockFilter, showZeroStockMaterials]);

  const filteredUsage = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return usageRecords.filter((record) =>
      !keyword
        ? true
        : [record.sapNo, record.materialName, record.batchNo, record.userName, record.purpose]
            .join(" ")
            .toLowerCase()
            .includes(keyword),
    );
  }, [usageRecords, query]);

  const filteredReservations = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return reservationRecords
      .filter((record) => {
        if (hideReceivedReservations && record.receivedAt) return false;
        return !keyword
          ? true
          : [record.requester, record.sapNo, record.materialName, record.unit, record.expectedDate]
              .join(" ")
              .toLowerCase()
              .includes(keyword);
      })
      .sort((a, b) => {
        const direction = reservationSort === "newest" ? -1 : 1;
        const dateCompare = a.expectedDate.localeCompare(b.expectedDate);
        if (dateCompare !== 0) return dateCompare * direction;
        return a.createdAt.localeCompare(b.createdAt) * direction;
      });
  }, [reservationRecords, query, reservationSort, hideReceivedReservations]);

  const manualActiveReservations = manualReservations.filter((draft) => !isEmptyReservationDraft(draft));
  const manualErrorCount = manualActiveReservations.filter((draft) => validateReservationDraft(draft).length > 0).length;
  const bulkValidDrafts = bulkDrafts.filter((draft) => validateReservationDraft(draft).length === 0);
  const bulkErrorCount = bulkDrafts.length - bulkValidDrafts.length;

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await requestJson<{ ok: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setIsAuthenticated(true);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setIsSubmitting(true);
    try {
      await requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
      setMaterials([]);
      setUsageRecords([]);
      setReservationRecords([]);
      setIsAuthenticated(false);
      setMessage("已退出登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openBackupDialog() {
    setBackupPassword("");
    setBackupDialogMessage("");
    setIsBackupDialogOpen(true);
  }

  function closeBackupDialog() {
    if (isBackingUp) return;
    setBackupPassword("");
    setBackupDialogMessage("");
    setIsBackupDialogOpen(false);
  }

  async function handleBackupDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBackingUp(true);
    setBackupDialogMessage("");
    try {
      const result = await requestJson<BackupResponse>("/api/backup-database", {
        method: "POST",
        body: JSON.stringify({ password: backupPassword }),
      });
      setBackupPassword("");
      setIsBackupDialogOpen(false);
      setMessage(
        result.sent
          ? `数据库备份已发送至 ${result.to || "kerorosen@gmail.com"}。备份时间：${result.generatedAt}`
          : `数据库备份文件已生成，当前为测试模式，未发送邮件。备份时间：${result.generatedAt}`,
      );
    } catch (error) {
      setBackupDialogMessage(error instanceof Error ? error.message : "数据库备份发送失败。");
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handleMaterialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/materials", {
        method: isEditingMaterial ? "PUT" : "POST",
        body: JSON.stringify(isEditingMaterial ? { ...materialForm, id: editingMaterialId } : materialForm),
      });
      applyState(state);
      setEditingMaterialId(null);
      setMaterialForm({ ...emptyMaterial, receivedDate: getTodayDate() });
      setMessage(isEditingMaterial ? "物料元数据已更新，库存总览已同步。" : "入库成功，库存已同步到服务器。");
      setActiveTab("inventory");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isEditingMaterial ? "保存修改失败。" : "入库失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNewMaterial() {
    setEditingMaterialId(null);
    setMaterialForm({ ...emptyMaterial, receivedDate: getTodayDate() });
    setActiveTab("intake");
  }

  function startEditMaterial(batch: MaterialBatch) {
    setEditingMaterialId(batch.id);
    setMaterialForm({
      sapNo: batch.sapNo,
      name: batch.name,
      category: batch.category,
      specification: batch.specification,
      unit: batch.unit,
      batchNo: batch.batchNo,
      supplier: batch.supplier,
      storageLocation: batch.storageLocation,
      receivedDate: batch.receivedDate || getTodayDate(),
      expiryDate: batch.expiryDate,
      initialQuantity: String(batch.initialQuantity),
      minQuantity: String(batch.minQuantity),
      notes: batch.notes,
    });
    setMessage("正在编辑库存物料，请补充或修正元数据后保存。");
    setActiveTab("intake");
  }

  function cancelEditMaterial() {
    setEditingMaterialId(null);
    setMaterialForm({ ...emptyMaterial, receivedDate: getTodayDate() });
    setMessage("");
    setActiveTab("inventory");
  }

  async function handleUsageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/usage-records", {
        method: "POST",
        body: JSON.stringify(usageForm),
      });
      applyState(state);
      setUsageForm({ ...emptyUsage, usedDate: getTodayDate() });
      setMessage("领用登记成功，剩余库存已同步扣减。");
      setActiveTab("inventory");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "领用登记失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function reservationPayloadFromDraft(draft: ReservationDraft) {
    return {
      requester: draft.requester.trim(),
      sapNo: draft.sapNo.trim(),
      materialName: draft.materialName.trim(),
      unit: draft.unit.trim(),
      quantity: draft.quantity.trim(),
      expectedDate: normalizeDateCell(draft.expectedDate),
    };
  }

  function updateManualReservation(index: number, field: keyof Omit<ReservationDraft, "id">, value: string) {
    setManualReservations((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, [field]: value } : draft)),
    );
  }

  function addManualReservationRow() {
    setManualReservations((current) => [...current, createReservationDraft()]);
  }

  function removeManualReservationRow(index: number) {
    setManualReservations((current) => {
      const next = current.filter((_, draftIndex) => draftIndex !== index);
      return next.length > 0 ? next : [createReservationDraft()];
    });
  }

  async function handleReservationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (manualActiveReservations.length === 0) {
      setMessage("请至少填写 1 行预约物料。");
      return;
    }
    if (manualErrorCount > 0) {
      setMessage("请检查预约表格中未填写完整或格式不正确的行。");
      return;
    }

    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/reservations", {
        method: "POST",
        body: JSON.stringify({ reservations: manualActiveReservations.map(reservationPayloadFromDraft) }),
      });
      applyState(state);
      const submittedCount = manualActiveReservations.length;
      setManualReservations([createReservationDraft({}, "manual-row-1")]);
      setMessage(`已提交 ${submittedCount} 条领料预约，预约清单已更新。`);
      setActiveTab("reservationList");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交预约失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function analyzeBulkPaste() {
    const rows = parseBulkPasteText(bulkPasteText);
    if (rows.length === 0) {
      setBulkRows([]);
      setBulkColumnMapping([]);
      setBulkDrafts([]);
      setBulkHasHeader(false);
      setBulkMessage("请先粘贴需要预约的物料数据。");
      return;
    }
    const detected = detectBulkColumns(rows);
    setBulkRows(rows);
    setBulkColumnMapping(detected.mapping);
    setBulkDrafts(buildBulkReservationDrafts(rows, detected.mapping, detected.hasHeader));
    setBulkHasHeader(detected.hasHeader);
    setBulkMessage(detected.hasHeader ? "已按表头识别列含义，请核对后提交。" : "已根据内容推测列含义，请核对后提交。");
  }

  function clearBulkPaste() {
    setBulkPasteText("");
    setBulkRows([]);
    setBulkColumnMapping([]);
    setBulkDrafts([]);
    setBulkHasHeader(false);
    setBulkMessage("");
  }

  function updateBulkColumnMapping(index: number, value: BulkColumnKey) {
    setBulkColumnMapping((current) => {
      const next = current.map((column, columnIndex) => (columnIndex === index ? value : column));
      setBulkDrafts(buildBulkReservationDrafts(bulkRows, next, bulkHasHeader));
      return next;
    });
  }

  function updateBulkHeaderMode(hasHeader: boolean) {
    setBulkHasHeader(hasHeader);
    if (bulkRows.length === 0) return;
    if (hasHeader) {
      const columnCount = Math.max(...bulkRows.map((row) => row.length), 0);
      const next = Array.from({ length: columnCount }, (_, index) => detectHeaderColumn(bulkRows[0]?.[index] ?? ""));
      setBulkColumnMapping(next);
      setBulkDrafts(buildBulkReservationDrafts(bulkRows, next, true));
      return;
    }
    const next = guessBulkColumns(bulkRows);
    setBulkColumnMapping(next);
    setBulkDrafts(buildBulkReservationDrafts(bulkRows, next, false));
  }

  function updateBulkDraft(index: number, field: keyof Omit<ReservationDraft, "id">, value: string) {
    setBulkDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, [field]: value } : draft)),
    );
  }

  async function handleBulkReservationSubmit() {
    if (bulkDrafts.length === 0) {
      setBulkMessage("请先识别粘贴内容。");
      return;
    }
    if (bulkErrorCount > 0) {
      setBulkMessage("预览中仍有错误，请修正列含义或单元格内容后再提交。");
      return;
    }

    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          reservations: bulkValidDrafts.map(reservationPayloadFromDraft),
        }),
      });
      applyState(state);
      const submittedCount = bulkValidDrafts.length;
      clearBulkPaste();
      setMessage(`已批量提交 ${submittedCount} 条领料预约，预约清单已更新。`);
      setActiveTab("reservationList");
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "批量提交预约失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleReservationReceipt(record: ReservationRecord) {
    const isReceived = Boolean(record.receivedAt);
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/reservations", {
        method: "PATCH",
        body: JSON.stringify({ id: record.id, action: isReceived ? "undoReceive" : "receive" }),
      });
      applyState(state);
      setMessage(
        isReceived
          ? `${record.materialName} 已撤销入研发库，预约状态已恢复。`
          : `${record.materialName} 已确认需从仓储领取，并自动完成入库；预约记录已保留。`,
      );
      setActiveTab("reservationList");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : isReceived ? "撤销入研发库失败。" : "确认领取失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmDeleteReservation() {
    if (!reservationToDelete) return;
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>(`/api/reservations?id=${encodeURIComponent(reservationToDelete.id)}`, {
        method: "DELETE",
      });
      applyState(state);
      setMessage(`${reservationToDelete.materialName} 的预约记录已删除。`);
      setReservationToDelete(null);
      setActiveTab("reservationList");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除预约记录失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmDeleteMaterial() {
    if (!materialToDelete) return;
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>(`/api/materials?id=${encodeURIComponent(materialToDelete.id)}`, {
        method: "DELETE",
      });
      applyState(state);
      setMessage(`${materialToDelete.name} 已删除。`);
      setMaterialToDelete(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除物料失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">科研物料管理</p>
          <h1>{APP_DISPLAY_TITLE}</h1>
          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <label>
              试用密码
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入共享密码"
                required
                disabled={isSubmitting || isLoading}
              />
            </label>
            {message ? <div className="notice">{message}</div> : null}
            <button className="primary" type="submit" disabled={isSubmitting || isLoading}>
              {isLoading ? "正在检查登录状态" : "进入台账"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">科研物料管理</p>
          <h1>{APP_DISPLAY_TITLE}</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={() => exportCsv("库存总览.csv", materials.map(formatMaterialExport))}>
            导出库存
          </button>
          <button className="secondary" onClick={openBackupDialog} disabled={isBackingUp || isSubmitting}>
            {isBackingUp ? "正在备份" : "备份数据库"}
          </button>
          <button className="secondary" onClick={() => exportCsv("领用记录.csv", usageRecords.map(formatUsageExport))}>
            导出流水
          </button>
          <button className="secondary" onClick={loadState} disabled={isSubmitting || isLoading}>
            刷新
          </button>
          <button className="secondary" onClick={handleLogout} disabled={isSubmitting}>
            退出
          </button>
        </div>
      </header>

      <section className="stats-grid" aria-label="库存统计">
        <Stat label="物料批次" value={stats.total} />
        <Stat label="临期批次" value={stats.soon} tone="warning" />
        <Stat label="已过期" value={stats.expired} tone="danger" />
        <Stat label="低库存" value={stats.low} tone="warning" />
      </section>

      <nav className="tabs" aria-label="主要功能">
        <TabButton active={activeTab === "inventory"} onClick={() => setActiveTab("inventory")}>库存总览</TabButton>
        <TabButton active={activeTab === "intake"} onClick={() => setActiveTab("intake")}>物料入库</TabButton>
        <TabButton active={activeTab === "usage"} onClick={() => setActiveTab("usage")}>领用登记</TabButton>
        <TabButton active={activeTab === "records"} onClick={() => setActiveTab("records")}>流水记录</TabButton>
        <TabButton active={activeTab === "warehouseRequest"} tone="request" onClick={() => setActiveTab("warehouseRequest")}>从仓储领料预约</TabButton>
        <TabButton active={activeTab === "reservationList"} tone="schedule" onClick={() => setActiveTab("reservationList")}>预约清单</TabButton>
      </nav>

      {message ? <div className="notice">{message}</div> : null}

      {(activeTab === "inventory" || activeTab === "records" || activeTab === "reservationList") && (
        <section className="toolbar">
          <label className="search">
            <span>搜索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SAP号、物料、批号、供应商、领用人、预约人"
            />
          </label>
          {activeTab === "inventory" ? (
            <>
              <label>
                效期
                <select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value as ExpiryFilter)}>
                  <option value="all">全部</option>
                  <option value="normal">正常</option>
                  <option value="soon">临期</option>
                  <option value="expired">已过期</option>
                </select>
              </label>
              <label>
                库存
                <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)}>
                  <option value="all">全部</option>
                  <option value="enough">充足</option>
                  <option value="low">低库存</option>
                  <option value="empty">用尽</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={showZeroStockMaterials}
                  onChange={(event) => setShowZeroStockMaterials(event.target.checked)}
                />
                显示0库存物料
              </label>
            </>
          ) : null}
          {activeTab === "reservationList" ? (
            <>
              <label>
                排序
                <select
                  value={reservationSort}
                  onChange={(event) => setReservationSort(event.target.value as ReservationSort)}
                >
                  <option value="oldest">按时间逆序排列</option>
                  <option value="newest">按时间正序排列</option>
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={hideReceivedReservations}
                  onChange={(event) => setHideReceivedReservations(event.target.checked)}
                />
                隐藏已入库物料
              </label>
            </>
          ) : null}
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>库存总览</h2>
            <button className="primary" onClick={startNewMaterial}>新增入库</button>
          </div>
          <InventoryTable materials={filteredMaterials} onEdit={startEditMaterial} onDelete={setMaterialToDelete} />
        </section>
      )}

      {activeTab === "intake" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{isEditingMaterial ? "编辑物料元数据" : "物料入库"}</h2>
            {isEditingMaterial ? (
              <div className="panel-actions">
                <button className="secondary" type="button" onClick={cancelEditMaterial} disabled={isSubmitting}>取消编辑</button>
              </div>
            ) : null}
          </div>
          <form className="form-grid" onSubmit={handleMaterialSubmit}>
            <TextInput label="SAP号" value={materialForm.sapNo} onChange={(sapNo) => setMaterialForm({ ...materialForm, sapNo })} placeholder="8位数字" pattern="[0-9]{8}" maxLength={8} />
            <TextInput label="物料名称" value={materialForm.name} onChange={(name) => setMaterialForm({ ...materialForm, name })} required />
            <TextInput label="分类" value={materialForm.category} onChange={(category) => setMaterialForm({ ...materialForm, category })} placeholder="试剂 / 耗材 / 标准品" />
            <TextInput label="规格" value={materialForm.specification} onChange={(specification) => setMaterialForm({ ...materialForm, specification })} placeholder="500 mL/瓶" />
            <TextInput label="单位" value={materialForm.unit} onChange={(unit) => setMaterialForm({ ...materialForm, unit })} placeholder="瓶 / 盒 / g" />
            <TextInput label="批号" value={materialForm.batchNo} onChange={(batchNo) => setMaterialForm({ ...materialForm, batchNo })} />
            <TextInput label="供应商" value={materialForm.supplier} onChange={(supplier) => setMaterialForm({ ...materialForm, supplier })} />
            <TextInput label="存放位置" value={materialForm.storageLocation} onChange={(storageLocation) => setMaterialForm({ ...materialForm, storageLocation })} placeholder="试剂柜 A-02" />
            <TextInput label="入库日期" type="date" value={materialForm.receivedDate} onChange={(receivedDate) => setMaterialForm({ ...materialForm, receivedDate })} />
            <TextInput label="有效期" type="date" value={materialForm.expiryDate} onChange={(expiryDate) => setMaterialForm({ ...materialForm, expiryDate })} />
            <TextInput label="入库数量" type="number" value={materialForm.initialQuantity} onChange={(initialQuantity) => setMaterialForm({ ...materialForm, initialQuantity })} required min="0" step="0.01" />
            <TextInput label="最低库存" type="number" value={materialForm.minQuantity} onChange={(minQuantity) => setMaterialForm({ ...materialForm, minQuantity })} min="0" step="0.01" />
            <label className="wide">
              备注
              <textarea value={materialForm.notes} onChange={(event) => setMaterialForm({ ...materialForm, notes: event.target.value })} />
            </label>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={isSubmitting}>{isEditingMaterial ? "保存修改" : "保存入库"}</button>
            </div>
          </form>
        </section>
      )}

      {activeTab === "usage" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>领用登记</h2>
            <p>可领用批次按近效期优先排序。</p>
          </div>
          <form className="form-grid" onSubmit={handleUsageSubmit}>
            <label className="wide">
              物料批次
              <select
                value={usageForm.materialBatchId}
                onChange={(event) => setUsageForm({ ...usageForm, materialBatchId: event.target.value })}
                required
              >
                <option value="">请选择可领用批次</option>
                {usableMaterials.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.sapNo} / {batch.name} / {batch.batchNo} / 剩余 {batch.remainingQuantity} {batch.unit} / 有效期 {batch.expiryDate}
                  </option>
                ))}
              </select>
            </label>
            <TextInput label="领用人" value={usageForm.userName} onChange={(userName) => setUsageForm({ ...usageForm, userName })} required />
            <TextInput label="领用日期" type="date" value={usageForm.usedDate} onChange={(usedDate) => setUsageForm({ ...usageForm, usedDate })} required />
            <TextInput label="领用量" type="number" value={usageForm.usedQuantity} onChange={(usedQuantity) => setUsageForm({ ...usageForm, usedQuantity })} required min="0" step="0.01" />
            <TextInput label="用途 / 项目" value={usageForm.purpose} onChange={(purpose) => setUsageForm({ ...usageForm, purpose })} placeholder="项目编号或实验用途" />
            <label className="wide">
              备注
              <textarea value={usageForm.notes} onChange={(event) => setUsageForm({ ...usageForm, notes: event.target.value })} />
            </label>
            {selectedBatch ? (
              <div className="batch-preview wide">
                <strong>{selectedBatch.name}</strong>
                <span>SAP号 {selectedBatch.sapNo || "-"}</span>
                <span>批号 {selectedBatch.batchNo}</span>
                <span>当前可用 {selectedBatch.remainingQuantity} {selectedBatch.unit}</span>
                <span>有效期 {selectedBatch.expiryDate}</span>
              </div>
            ) : null}
            <div className="form-actions">
              <button className="primary" type="submit" disabled={isSubmitting}>提交领用并扣减库存</button>
            </div>
          </form>
        </section>
      )}

      {activeTab === "warehouseRequest" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>从仓储领料预约</h2>
            <p>提交后进入预约清单，便于物料管理员提前安排本周领料。</p>
          </div>
          <form className="reservation-entry" onSubmit={handleReservationSubmit}>
            <div className="table-wrap reservation-entry-wrap">
              <table className="reservation-entry-table">
                <thead>
                  <tr>
                    <th>预约人</th>
                    <th>SAP号</th>
                    <th>物料名称</th>
                    <th>单位</th>
                    <th>数量</th>
                    <th>期望入库日期</th>
                    <th>星期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {manualReservations.map((draft, index) => {
                    const errors = isEmptyReservationDraft(draft) ? [] : validateReservationDraft(draft);
                    return (
                      <tr key={draft.id}>
                        <td>
                          <input
                            value={draft.requester}
                            onChange={(event) => updateManualReservation(index, "requester", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            value={draft.sapNo}
                            onChange={(event) => updateManualReservation(index, "sapNo", event.target.value)}
                            placeholder="8位数字"
                            maxLength={8}
                          />
                        </td>
                        <td>
                          <input
                            value={draft.materialName}
                            onChange={(event) => updateManualReservation(index, "materialName", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            value={draft.unit}
                            onChange={(event) => updateManualReservation(index, "unit", event.target.value)}
                            placeholder="瓶 / 盒 / g"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={draft.quantity}
                            onChange={(event) => updateManualReservation(index, "quantity", event.target.value)}
                            min="0"
                            step="0.01"
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            value={draft.expectedDate}
                            onChange={(event) => updateManualReservation(index, "expectedDate", event.target.value)}
                          />
                        </td>
                        <td>{draft.expectedDate ? formatWeekday(draft.expectedDate) : "-"}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="table-action table-action-danger"
                              type="button"
                              onClick={() => removeManualReservationRow(index)}
                              disabled={isSubmitting}
                            >
                              删除
                            </button>
                          </div>
                          {errors.length > 0 ? <small className="bulk-error">{errors.join("；")}</small> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button className="secondary" type="button" onClick={addManualReservationRow} disabled={isSubmitting}>
                增行
              </button>
              <button
                className="primary"
                type="submit"
                disabled={isSubmitting || manualActiveReservations.length === 0 || manualErrorCount > 0}
              >
                提交 {manualActiveReservations.length} 条预约
              </button>
            </div>
          </form>
          <div className="bulk-import">
            <div className="bulk-heading">
              <h3>批量粘贴预约</h3>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={bulkHasHeader}
                  onChange={(event) => updateBulkHeaderMode(event.target.checked)}
                  disabled={bulkRows.length === 0}
                />
                首行是表头
              </label>
            </div>
            <label className="wide">
              粘贴物料数据
              <textarea
                value={bulkPasteText}
                onChange={(event) => {
                  setBulkPasteText(event.target.value);
                  setBulkMessage("");
                }}
                placeholder="预约人	SAP号	物料名称	单位	数量	期望入库日期"
              />
            </label>
            <div className="form-actions">
              <button className="secondary" type="button" onClick={clearBulkPaste} disabled={isSubmitting}>
                清空
              </button>
              <button className="secondary" type="button" onClick={analyzeBulkPaste} disabled={isSubmitting}>
                识别粘贴内容
              </button>
            </div>
            {bulkMessage ? <p className={bulkErrorCount > 0 ? "dialog-error" : "inline-note"}>{bulkMessage}</p> : null}
            {bulkRows.length > 0 ? (
              <>
                <div className="table-wrap bulk-mapping-wrap">
                  <table className="bulk-mapping-table">
                    <thead>
                      <tr>
                        {bulkColumnMapping.map((column, index) => (
                          <th key={`bulk-column-${index}`}>
                            第 {index + 1} 列
                            <select
                              value={column}
                              onChange={(event) => updateBulkColumnMapping(index, event.target.value as BulkColumnKey)}
                            >
                              {bulkColumnOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {bulkColumnMapping.map((_, columnIndex) => (
                          <td key={`bulk-sample-${columnIndex}`}>
                            {bulkRows[bulkHasHeader ? 1 : 0]?.[columnIndex] || "-"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="table-wrap bulk-preview-wrap">
                  <table className="bulk-preview-table reservation-entry-table">
                    <thead>
                      <tr>
                        <th>行号</th>
                        <th>预约人</th>
                        <th>SAP号</th>
                        <th>物料名称</th>
                        <th>单位</th>
                        <th>数量</th>
                        <th>期望入库日期</th>
                        <th>星期</th>
                        <th>识别状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkDrafts.map((draft, index) => {
                        const errors = validateReservationDraft(draft);
                        return (
                          <tr key={draft.id}>
                            <td>{draft.rowNumber}</td>
                            <td>
                              <input
                                value={draft.requester}
                                onChange={(event) => updateBulkDraft(index, "requester", event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                value={draft.sapNo}
                                onChange={(event) => updateBulkDraft(index, "sapNo", event.target.value)}
                                maxLength={8}
                              />
                            </td>
                            <td>
                              <input
                                value={draft.materialName}
                                onChange={(event) => updateBulkDraft(index, "materialName", event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                value={draft.unit}
                                onChange={(event) => updateBulkDraft(index, "unit", event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                value={draft.quantity}
                                onChange={(event) => updateBulkDraft(index, "quantity", event.target.value)}
                                min="0"
                                step="0.01"
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                value={draft.expectedDate}
                                onChange={(event) => updateBulkDraft(index, "expectedDate", event.target.value)}
                              />
                            </td>
                            <td>{draft.expectedDate ? formatWeekday(draft.expectedDate) : "-"}</td>
                            <td>
                              {errors.length ? (
                                <span className="bulk-error">{errors.join("；")}</span>
                              ) : (
                                <span className="bulk-ok">可提交</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <button
                    className="primary"
                    type="button"
                    onClick={handleBulkReservationSubmit}
                    disabled={isSubmitting || bulkDrafts.length === 0 || bulkErrorCount > 0}
                  >
                    提交 {bulkValidDrafts.length} 条预约
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </section>
      )}

      {activeTab === "reservationList" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>预约清单</h2>
            <button className="secondary" onClick={() => exportCsv("仓储领料预约清单.csv", filteredReservations.map(formatReservationExport))}>导出Excel</button>
          </div>
          <ReservationsTable
            records={filteredReservations}
            onToggleReceipt={handleToggleReservationReceipt}
            onDelete={setReservationToDelete}
            isSubmitting={isSubmitting}
          />
        </section>
      )}

      {activeTab === "records" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>领用流水</h2>
            <button className="secondary" onClick={() => exportCsv("领用记录.csv", usageRecords.map(formatUsageExport))}>导出流水</button>
          </div>
          <RecordsTable records={filteredUsage} />
        </section>
      )}

      {materialToDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-material-title">
            <h2 id="delete-material-title">是否确认删除</h2>
            <p>{materialToDelete.name}</p>
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setMaterialToDelete(null)} disabled={isSubmitting}>
                否
              </button>
              <button className="danger-action" type="button" onClick={confirmDeleteMaterial} disabled={isSubmitting}>
                是
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {reservationToDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-reservation-title">
            <h2 id="delete-reservation-title">是否确认删除</h2>
            <p>{reservationToDelete.materialName}</p>
            <div className="dialog-actions">
              <button className="secondary" type="button" onClick={() => setReservationToDelete(null)} disabled={isSubmitting}>
                否
              </button>
              <button className="danger-action" type="button" onClick={confirmDeleteReservation} disabled={isSubmitting}>
                是
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isBackupDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-password-title">
            <h2 id="backup-password-title">备份密码</h2>
            <form className="dialog-form" onSubmit={handleBackupDatabase}>
              <label>
                请输入备份密码
                <input
                  type="password"
                  value={backupPassword}
                  onChange={(event) => setBackupPassword(event.target.value)}
                  autoFocus
                  required
                  disabled={isBackingUp}
                />
              </label>
              {backupDialogMessage ? <p className="dialog-error">{backupDialogMessage}</p> : null}
              <div className="dialog-actions">
                <button className="secondary" type="button" onClick={closeBackupDialog} disabled={isBackingUp}>
                  取消
                </button>
                <button className="primary" type="submit" disabled={isBackingUp}>
                  {isBackingUp ? "正在备份" : "确认备份"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: string }) {
  return (
    <article className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TabButton({
  active,
  children,
  onClick,
  tone,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  tone?: "request" | "schedule";
}) {
  const className = ["tab", active ? "active" : "", tone ? `tab-${tone}` : ""].filter(Boolean).join(" ");
  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  min,
  step,
  pattern,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: string;
  step?: string;
  pattern?: string;
  maxLength?: number;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        min={min}
        step={step}
        pattern={pattern}
        maxLength={maxLength}
      />
    </label>
  );
}

function InventoryTable({
  materials,
  onEdit,
  onDelete,
}: {
  materials: MaterialBatch[];
  onEdit: (batch: MaterialBatch) => void;
  onDelete: (batch: MaterialBatch) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SAP号</th>
            <th>物料</th>
            <th>分类</th>
            <th>规格</th>
            <th>批号</th>
            <th>供应商</th>
            <th>入库 / 有效期</th>
            <th>库存</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((batch) => {
            const expiry = getExpiryStatus(batch);
            const stock = getStockStatus(batch);
            return (
              <tr key={batch.id}>
                <td><strong>{batch.sapNo || "-"}</strong></td>
                <td>
                  <strong>{batch.name}</strong>
                  <small>{batch.storageLocation || "未填写位置"}</small>
                </td>
                <td>{batch.category}</td>
                <td>{batch.specification || "-"}</td>
                <td>{batch.batchNo}</td>
                <td>{batch.supplier || "-"}</td>
                <td>
                  <span>{batch.receivedDate}</span>
                  <small>{batch.expiryDate}</small>
                </td>
                <td>
                  <strong>{batch.remainingQuantity} {batch.unit}</strong>
                  <small>初始 {batch.initialQuantity} / 下限 {batch.minQuantity}</small>
                </td>
                <td>
                  <Badge tone={expiry.tone}>{expiry.label}</Badge>
                  <Badge tone={stock.tone}>{stock.label}</Badge>
                </td>
                <td>
                  <div className="table-actions">
                    <button className="table-action" type="button" onClick={() => onEdit(batch)}>编辑</button>
                    <button className="table-action table-action-danger" type="button" onClick={() => onDelete(batch)}>
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {materials.length === 0 ? <p className="empty">没有匹配的库存记录。</p> : null}
    </div>
  );
}

function RecordsTable({ records }: { records: UsageRecord[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>领用日期</th>
            <th>SAP号</th>
            <th>物料</th>
            <th>批号</th>
            <th>领用人</th>
            <th>领用量</th>
            <th>用途 / 项目</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.usedDate}</td>
              <td>{record.sapNo || "-"}</td>
              <td><strong>{record.materialName}</strong></td>
              <td>{record.batchNo}</td>
              <td>{record.userName}</td>
              <td>{record.usedQuantity}</td>
              <td>{record.purpose || "-"}</td>
              <td>{record.notes || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length === 0 ? <p className="empty">没有匹配的领用记录。</p> : null}
    </div>
  );
}

function ReservationsTable({
  records,
  onToggleReceipt,
  onDelete,
  isSubmitting,
}: {
  records: ReservationRecord[];
  onToggleReceipt: (record: ReservationRecord) => void;
  onDelete: (record: ReservationRecord) => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>期望入库日期</th>
            <th>星期</th>
            <th>预约人</th>
            <th>SAP号</th>
            <th>物料名称</th>
            <th>数量</th>
            <th>单位</th>
            <th>提交时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const isReceived = Boolean(record.receivedAt);
            return (
              <tr key={record.id}>
                <td>{record.expectedDate}</td>
                <td>{formatWeekday(record.expectedDate)}</td>
                <td>{record.requester}</td>
                <td><strong>{record.sapNo}</strong></td>
                <td>{record.materialName}</td>
                <td>{record.quantity}</td>
                <td>{record.unit}</td>
                <td>{record.createdAt.slice(0, 10)}</td>
                <td>
                  <div className="table-actions">
                    <button
                      className={`table-action ${isReceived ? "table-action-muted" : ""}`}
                      type="button"
                      onClick={() => onToggleReceipt(record)}
                      disabled={isSubmitting}
                    >
                      {isReceived ? "已入研发库" : "需从仓储领取"}
                    </button>
                    <button
                      className="table-action table-action-danger"
                      type="button"
                      onClick={() => onDelete(record)}
                      disabled={isSubmitting}
                    >
                      删除
                    </button>
                  </div>
                  {isReceived ? <small>{record.receivedAt.slice(0, 10)}</small> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {records.length === 0 ? <p className="empty">暂无领料预约。</p> : null}
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function formatMaterialExport(batch: MaterialBatch) {
  return {
    SAP号: batch.sapNo,
    物料名称: batch.name,
    分类: batch.category,
    规格: batch.specification,
    单位: batch.unit,
    批号: batch.batchNo,
    供应商: batch.supplier,
    存放位置: batch.storageLocation,
    入库日期: batch.receivedDate,
    有效期: batch.expiryDate,
    初始数量: batch.initialQuantity,
    剩余数量: batch.remainingQuantity,
    最低库存: batch.minQuantity,
    效期状态: getExpiryStatus(batch).label,
    库存状态: getStockStatus(batch).label,
    备注: batch.notes,
  };
}

function formatUsageExport(record: UsageRecord) {
  return {
    SAP号: record.sapNo,
    物料名称: record.materialName,
    批号: record.batchNo,
    领用人: record.userName,
    领用日期: record.usedDate,
    领用量: record.usedQuantity,
    用途项目: record.purpose,
    备注: record.notes,
    创建时间: record.createdAt,
  };
}

function formatReservationExport(record: ReservationRecord) {
  return {
    期望入库日期: record.expectedDate,
    星期: formatWeekday(record.expectedDate),
    预约人: record.requester,
    SAP号: record.sapNo,
    物料名称: record.materialName,
    数量: record.quantity,
    单位: record.unit,
    状态: record.receivedAt ? "已入研发库" : "待领取",
    入研发库时间: record.receivedAt,
    提交时间: record.createdAt,
  };
}

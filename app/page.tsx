"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { InventoryState, MaterialBatch, UsageRecord } from "@/lib/materials";

type Tab = "inventory" | "intake" | "usage" | "records";
type ExpiryFilter = "all" | "normal" | "soon" | "expired";
type StockFilter = "all" | "enough" | "low" | "empty";

const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const emptyMaterial = {
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
  const [materialForm, setMaterialForm] = useState(() => ({ ...emptyMaterial, receivedDate: getTodayDate() }));
  const [usageForm, setUsageForm] = useState(() => ({ ...emptyUsage, usedDate: getTodayDate() }));
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [message, setMessage] = useState("");

  const applyState = useCallback((state: InventoryState) => {
    setMaterials(state.materials);
    setUsageRecords(state.usageRecords);
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
        [batch.name, batch.category, batch.batchNo, batch.supplier, batch.storageLocation]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const expiryStatus = getExpiryStatus(batch).key;
      const stockStatus = getStockStatus(batch).key;
      const matchesExpiry = expiryFilter === "all" || expiryStatus === expiryFilter;
      const matchesStock = stockFilter === "all" || stockStatus === stockFilter;
      return matchesKeyword && matchesExpiry && matchesStock;
    });
  }, [materials, query, expiryFilter, stockFilter]);

  const filteredUsage = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return usageRecords.filter((record) =>
      !keyword
        ? true
        : [record.materialName, record.batchNo, record.userName, record.purpose].join(" ").toLowerCase().includes(keyword),
    );
  }, [usageRecords, query]);

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
      setIsAuthenticated(false);
      setMessage("已退出登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMaterialSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/materials", {
        method: "POST",
        body: JSON.stringify(materialForm),
      });
      applyState(state);
      setMaterialForm({ ...emptyMaterial, receivedDate: getTodayDate() });
      setMessage("入库成功，库存已同步到服务器。");
      setActiveTab("inventory");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "入库失败。");
    } finally {
      setIsSubmitting(false);
    }
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

  async function resetDemoData() {
    setIsSubmitting(true);
    try {
      const state = await requestJson<InventoryState>("/api/reset-demo", { method: "POST" });
      applyState(state);
      setMessage("已恢复演示数据，并同步到服务器。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复演示数据失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">科研物料管理</p>
          <h1>实验室库存与领用台账</h1>
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
          <h1>实验室库存与领用台账</h1>
        </div>
        <div className="top-actions">
          <button className="secondary" onClick={() => exportCsv("库存总览.csv", materials.map(formatMaterialExport))}>
            导出库存
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
      </nav>

      {message ? <div className="notice">{message}</div> : null}

      {(activeTab === "inventory" || activeTab === "records") && (
        <section className="toolbar">
          <label className="search">
            <span>搜索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="物料、批号、供应商、领用人"
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
            </>
          ) : null}
        </section>
      )}

      {activeTab === "inventory" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>库存总览</h2>
            <button className="primary" onClick={() => setActiveTab("intake")}>新增入库</button>
          </div>
          <InventoryTable materials={filteredMaterials} />
        </section>
      )}

      {activeTab === "intake" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>物料入库</h2>
            <button className="secondary" onClick={resetDemoData} disabled={isSubmitting}>恢复演示数据</button>
          </div>
          <form className="form-grid" onSubmit={handleMaterialSubmit}>
            <TextInput label="物料名称" value={materialForm.name} onChange={(name) => setMaterialForm({ ...materialForm, name })} required />
            <TextInput label="分类" value={materialForm.category} onChange={(category) => setMaterialForm({ ...materialForm, category })} placeholder="试剂 / 耗材 / 标准品" />
            <TextInput label="规格" value={materialForm.specification} onChange={(specification) => setMaterialForm({ ...materialForm, specification })} placeholder="500 mL/瓶" />
            <TextInput label="单位" value={materialForm.unit} onChange={(unit) => setMaterialForm({ ...materialForm, unit })} required placeholder="瓶 / 盒 / g" />
            <TextInput label="批号" value={materialForm.batchNo} onChange={(batchNo) => setMaterialForm({ ...materialForm, batchNo })} required />
            <TextInput label="供应商" value={materialForm.supplier} onChange={(supplier) => setMaterialForm({ ...materialForm, supplier })} />
            <TextInput label="存放位置" value={materialForm.storageLocation} onChange={(storageLocation) => setMaterialForm({ ...materialForm, storageLocation })} placeholder="试剂柜 A-02" />
            <TextInput label="入库日期" type="date" value={materialForm.receivedDate} onChange={(receivedDate) => setMaterialForm({ ...materialForm, receivedDate })} />
            <TextInput label="有效期" type="date" value={materialForm.expiryDate} onChange={(expiryDate) => setMaterialForm({ ...materialForm, expiryDate })} required />
            <TextInput label="入库数量" type="number" value={materialForm.initialQuantity} onChange={(initialQuantity) => setMaterialForm({ ...materialForm, initialQuantity })} required min="0" step="0.01" />
            <TextInput label="最低库存" type="number" value={materialForm.minQuantity} onChange={(minQuantity) => setMaterialForm({ ...materialForm, minQuantity })} min="0" step="0.01" />
            <label className="wide">
              备注
              <textarea value={materialForm.notes} onChange={(event) => setMaterialForm({ ...materialForm, notes: event.target.value })} />
            </label>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={isSubmitting}>保存入库</button>
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
                    {batch.name} / {batch.batchNo} / 剩余 {batch.remainingQuantity} {batch.unit} / 有效期 {batch.expiryDate}
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

      {activeTab === "records" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>领用流水</h2>
            <button className="secondary" onClick={() => exportCsv("领用记录.csv", usageRecords.map(formatUsageExport))}>导出流水</button>
          </div>
          <RecordsTable records={filteredUsage} />
        </section>
      )}
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

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button className={active ? "tab active" : "tab"} onClick={onClick}>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: string;
  step?: string;
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
      />
    </label>
  );
}

function InventoryTable({ materials }: { materials: MaterialBatch[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>物料</th>
            <th>分类</th>
            <th>规格</th>
            <th>批号</th>
            <th>供应商</th>
            <th>入库 / 有效期</th>
            <th>库存</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((batch) => {
            const expiry = getExpiryStatus(batch);
            const stock = getStockStatus(batch);
            return (
              <tr key={batch.id}>
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

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function formatMaterialExport(batch: MaterialBatch) {
  return {
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LoaderCircle,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";
import type { BarcodeListRow, ProjectCategory, ProjectStatus } from "@/lib/issues";
import type { GroupDirectoryEntry, IssueWorkspaceProps } from "@/components/issues/types";
import { EntryModal } from "@/components/issues/EntryModal";
import { ImportModal } from "@/components/issues/ImportModal";
import { StatusModal } from "@/components/issues/StatusModal";
import { TransferModal } from "@/components/issues/TransferModal";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatShortDateTime } from "@/lib/time";

interface ListResponse {
  rows: BarcodeListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface Filters {
  search: string;
  groupId: string;
  statusId: string;
  categoryId: string;
  priority: string;
}

const LIST_TAB = "__issue_list__";

export function IssuesWorkspace({
  projectId,
  currentUser,
  access,
  groups,
  defaultGroupIds,
  statuses,
  categories,
  initialBarcodeId,
  initialBarcodeLabel,
  initialOpenCreate,
}: IssueWorkspaceProps) {
  const toast = useToast();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [filters, setFilters] = useState<Filters>({ search: "", groupId: "", statusId: "", categoryId: "", priority: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<{ id: string; label: string }[]>([]);
  const [activeTab, setActiveTab] = useState<string>(LIST_TAB);
  const [detailVersion, setDetailVersion] = useState(0);
  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const requestId = useRef(0);
  const initialized = useRef(false);

  const loadList = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setListError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search: filters.search,
        groupId: filters.groupId,
        statusId: filters.statusId,
        categoryId: filters.categoryId,
        priority: filters.priority,
      });
      const result = await apiFetch<ListResponse>(`/api/projects/${projectId}/issues?${params.toString()}`);
      if (currentRequest === requestId.current) {
        setData(result);
        setSelected(new Set());
        if (result.page !== page) setPage(result.page);
      }
    } catch (error) {
      if (currentRequest === requestId.current) setListError(errorMessage(error));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [projectId, page, pageSize, filters]);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (initialBarcodeId) {
      const label = initialBarcodeLabel || "条码详情";
      setTabs([{ id: initialBarcodeId, label }]);
      setActiveTab(initialBarcodeId);
    }
    if (initialOpenCreate) {
      setActiveTab(LIST_TAB);
      setEntryOpen(true);
    }
  }, [initialBarcodeId, initialBarcodeLabel, initialOpenCreate]);

  const rows = data?.rows || [];
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const selectedIssueCount = selectedRows.reduce((sum, row) => sum + row.issue_count, 0);
  const canBulkUpdate = selectedRows.length > 0 && selectedRows.every((row) => row.permissions.canUpdateAllStatuses);
  const canBulkTransfer = selectedRows.length > 0 && selectedRows.every((row) => row.permissions.canTransferAll);
  const activeFilters = [filters.search, filters.groupId, filters.statusId, filters.categoryId, filters.priority].filter(Boolean).length;
  const currentGroupUnion = [...new Set(selectedRows.flatMap((row) => row.groups.map((group) => group.id)))];
  const commonGroups = selectedRows.length === 0
    ? []
    : selectedRows.reduce<string[]>((acc, row, index) => {
        const ids = row.groups.map((group) => group.id);
        return index === 0 ? ids : acc.filter((id) => ids.includes(id));
      }, []);
  function resetFilters() {
    setSearchDraft("");
    setFilters({ search: "", groupId: "", statusId: "", categoryId: "", priority: "" });
    setPage(1);
  }

  function applyFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function scrollToTabTop() {
    if (typeof window === "undefined") return;
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 40);
  }

  function activateTab(id: string) {
    if (activeTab === id) return;
    setActiveTab(id);
    scrollToTabTop();
  }

  function openTab(id: string, label: string) {
    setTabs((current) => current.some((tab) => tab.id === id) ? current : [...current, { id, label }]);
    setActiveTab(id);
    scrollToTabTop();
  }

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (activeTab === id) {
      const nextActive = next[Math.max(0, index - 1)]?.id || next[0]?.id || LIST_TAB;
      setActiveTab(nextActive);
      scrollToTabTop();
    }
  }

  function closeAllTabs() {
    setTabs([]);
    setActiveTab(LIST_TAB);
    scrollToTabTop();
  }

  function notifyListChanged() {
    void loadList();
  }

  function bumpDetailVersion() {
    setDetailVersion((version) => version + 1);
  }

  function handleCreated(barcodeId: string, barcodeLabel: string) {
    toast.success("问题已录入并按当前排班完成责任分配");
    setEntryOpen(false);
    setPage(1);
    void loadList();
    if (barcodeId) openTab(barcodeId, barcodeLabel);
    else toast.success("条码已录入，正在刷新列表");
  }

  function selectAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }

  async function deleteSelected() {
    setDeletePending(true);
    try {
      const ids = [...selected];
      const result = await apiFetch<{
        deleted: { id: string; barcode: string }[];
        reviewRequired: { id: string; barcode: string }[];
        requestId: string | null;
      }>(`/api/projects/${projectId}/issues/batch-delete`, { method: "POST", body: JSON.stringify({ barcodeIds: ids }) });
      setDeleteOpen(false);
      setSelected(new Set());
      if (result.deleted.length > 0) {
        const deletedIds = new Set(result.deleted.map((item) => item.id));
        setTabs((current) => current.filter((tab) => !deletedIds.has(tab.id)));
        if (deletedIds.has(activeTab)) setActiveTab(LIST_TAB);
        toast.success(`已删除 ${result.deleted.length} 个条码`);
      }
      if (result.reviewRequired.length > 0) {
        toast.info(`${result.reviewRequired.length} 个条码存在定位或责任历史，已提交项目 PM 删除审批，审批通过前保留`);
      }
      bumpDetailVersion();
      await loadList();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletePending(false);
    }
  }

  const pageNumbers = useMemo(() => {
    if (!data) return [];
    const total = data.pageCount;
    const start = Math.max(1, Math.min(data.page - 2, total - 4));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [data]);

  return (
    <div className="page-stack issues-page">
      <div className="page-header">
        <div>
          <div className="page-kicker">Issue Tracking</div>
          <h1 className="page-title">问题跟踪</h1>
          <p className="page-sub">条码列表、搜索与筛选位于第一个标签页中。点击条码会在顶部新开一个详情标签页，可随时在两个标签页之间切换，无需上下滚动寻找列表。</p>
        </div>
      </div>

      <div className="issue-main-tabs" role="tablist" aria-label="问题跟踪主标签页">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === LIST_TAB}
          className={`issue-main-tab ${activeTab === LIST_TAB ? "active" : ""}`}
          onClick={() => activateTab(LIST_TAB)}
        >
          <ListChecks size={14} />
          <span>条码列表</span>
          {data ? <span className="issue-tab-count">{data.total}</span> : null}
        </button>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={0}
            className={`issue-main-tab issue-main-barcode-tab ${activeTab === tab.id ? "active" : ""}`}
            title={tab.label}
            onClick={() => activateTab(tab.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") activateTab(tab.id); }}
          >
            <span className="issue-main-tab-label">{tab.label}</span>
            <button
              type="button"
              className="issue-tab-close"
              aria-label={`关闭 ${tab.label}`}
              onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <span className="spacer" />
        {tabs.length > 0 ? (
          <button type="button" className="issue-tabbar-action" onClick={closeAllTabs} title="关闭全部条码标签页">
            <X size={12} /> <span>关闭全部</span>
          </button>
        ) : (
          <span className="issue-tabbar-hint">点击条码打开详情标签页</span>
        )}
      </div>

      <section
        className="issue-tab-panel issue-list-panel"
        hidden={activeTab !== LIST_TAB}
        role="tabpanel"
        aria-label="条码列表"
      >
        <div className="issue-list-actions">
          <div className="hint">
            {data ? `共 ${data.total} 个条码 · 当前第 ${data.page} / ${data.pageCount} 页` : "正在加载条码…"}
          </div>
          <div className="header-actions">
            <a className="btn btn-secondary" href={`/api/projects/${projectId}/issues/template`} target="_blank" rel="noreferrer"><Download size={14} /> 下载模板</a>
            <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}><Upload size={14} /> 批量导入</button>
            <button type="button" className="btn btn-primary" onClick={() => setEntryOpen(true)}><Plus size={15} /> 录入问题</button>
          </div>
        </div>

        <div className="card card-pad" style={{ paddingTop: 15, paddingBottom: filtersOpen ? 15 : 12 }}>
          <form
            className="issue-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilter("search", searchDraft.trim());
              setPage(1);
            }}
          >
            <div className="field search-field">
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)" }} />
                <input className="input" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索条码、库位号、云主机 IP…" style={{ paddingLeft: 33 }} />
              </div>
            </div>
            <button type="submit" className="btn btn-secondary">搜索</button>
            <button type="button" className={`btn ${activeFilters ? "btn-soft" : "btn-secondary"}`} onClick={() => setFiltersOpen((open) => !open)}>
              <Filter size={14} /> 筛选 {activeFilters ? <span className="active-filter-count">{activeFilters}</span> : null}
            </button>
            {activeFilters ? <button type="button" className="btn btn-ghost" onClick={resetFilters}>清除筛选</button> : null}
            <span className="spacer" />
            <button type="button" className="icon-btn" onClick={() => void loadList()} title="刷新"><RefreshCw size={14} /></button>
            <div className="field pagesize-select" style={{ minWidth: 98 }}>
              <select className="select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} aria-label="每页显示数量">
                {[10, 20, 50, 100].map((size) => <option key={size} value={size}>每页 {size}</option>)}
              </select>
            </div>
          </form>
          {filtersOpen ? (
            <div className="filters-panel">
              <div className="field">
                <label>责任组</label>
                <select className="select" value={filters.groupId} onChange={(event) => applyFilter("groupId", event.target.value)}>
                  <option value="">全部责任组</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>状态</label>
                <select className="select" value={filters.statusId} onChange={(event) => applyFilter("statusId", event.target.value)}>
                  <option value="">全部状态</option>
                  {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>问题分类</label>
                <select className="select" value={filters.categoryId} onChange={(event) => applyFilter("categoryId", event.target.value)}>
                  <option value="">全部分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>优先级</label>
                <select className="select" value={filters.priority} onChange={(event) => applyFilter("priority", event.target.value)}>
                  <option value="">全部优先级</option>
                  <option value="HIGH">高</option>
                  <option value="MEDIUM">中</option>
                  <option value="LOW">低</option>
                </select>
              </div>
            </div>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <div className="bulk-bar">
            <span>已选择 <b>{selected.size}</b> 个条码，共 {selectedIssueCount} 个问题项</span>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" disabled={!canBulkUpdate} onClick={() => setStatusOpen(true)}>
              批量更新状态
            </button>
            <button type="button" className="btn btn-sm" disabled={!canBulkTransfer} onClick={() => setTransferOpen(true)}>
              批量转移
            </button>
            <button type="button" className="btn btn-sm danger" onClick={() => setDeleteOpen(true)}>批量删除</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>取消选择</button>
          </div>
        ) : null}

            <div className="card">
              <div className="table-wrap">
                <table className="table issue-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" className="issue-check" checked={rows.length > 0 && selected.size === rows.length} onChange={(event) => selectAll(event.target.checked)} aria-label="全选当前页" /></th>
                      <th className="row-number">序号</th>
                      <th>条码 / 库位</th>
                      <th>参与责任组 / 当前处理人</th>
                      <th>状态</th>
                      <th>优先级</th>
                      <th>分类</th>
                      <th>更新时间</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && rows.length === 0 ? (
                      <tr><td colSpan={9}><div className="loading"><span className="spinner" /> 正在加载问题列表…</div></td></tr>
                    ) : listError ? (
                      <tr><td colSpan={9}><div className="table-empty"><div className="alert alert-error" style={{ display: "inline-flex" }}>{listError}</div></div></td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={9}>
                        <div className="empty-state" style={{ padding: "38px 20px" }}>
                          <div className="empty-icon"><Search size={20} /></div>
                          <h3>{activeFilters ? "没有匹配的问题" : "暂无问题记录"}</h3>
                          <p>{activeFilters ? "尝试调整筛选条件，或清除筛选后查看全部。" : "点击右上角「录入问题」开始追踪。"}</p>
                        </div>
                      </td></tr>
                    ) : rows.map((row, index) => (
                      <tr key={row.id} className={selected.has(row.id) ? "selected" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            className="issue-check"
                            checked={selected.has(row.id)}
                            aria-label={`选择条码 ${row.barcode}`}
                            onChange={(event) => {
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(row.id); else next.delete(row.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="row-number">{(data ? (data.page - 1) * data.pageSize : 0) + index + 1}</td>
                        <td>
                          <button type="button" className="barcode-link" onClick={() => openTab(row.id, row.barcode)}>
                            {row.barcode}
                          </button>
                          <span className="issue-count-pill">{row.issue_count} 项</span>
                          <div className="cell-sub mono">{row.location_no}{row.host_ip ? ` · ${row.host_ip}` : ""}</div>
                        </td>
                        <td className="group-cell">
                          {row.groups.length === 0 ? <span className="hint">未分配</span> : (
                            <div className="group-lines">
                              {row.groups.slice(0, 2).map((group) => (
                                <div className="group-line" key={group.id}>
                                  <span className="gname">{group.name}</span>
                                  <span>·</span>
                                  {group.handlers.length === 0 ? <span className="handler-name">无处理人</span> : group.handlers.slice(0, 3).map((handler) => (
                                    <span key={handler.id} className={handler.isPrimary ? "handler-primary" : "handler-name"}>{handler.name}{handler.isPrimary ? " 主" : ""}</span>
                                  ))}
                                  {group.handlers.length > 3 ? <span className="handler-more">+{group.handlers.length - 3}</span> : null}
                                </div>
                              ))}
                              {row.groups.length > 2 ? <div className="handler-more">另有 {row.groups.length - 2} 个责任组</div> : null}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="chip-list">
                            {row.statuses.map((status) => (
                              <span key={status.id} className="status-badge" style={{ color: status.color, background: `${status.color}12`, borderColor: `${status.color}2e` }}>{status.name}</span>
                            ))}
                          </div>
                        </td>
                        <td><span className={`priority priority-${row.priority.toLowerCase()}`}>{row.priority_label}</span></td>
                        <td>{row.category_name ? <span className="chip">{row.category_name}</span> : <span className="hint">—</span>}</td>
                        <td><span className="mini-meta">{formatShortDateTime(row.updated_at)}</span></td>
                        <td className="actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTab(row.id, row.barcode)}>详情</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-foot">
                <div className="table-footer-hint" style={{ paddingTop: 0 }}>
                  <span>{data ? `共 ${data.total} 个条码 · 第 ${data.page} / ${data.pageCount} 页` : "—"}</span>
                  <div className="pagination" style={{ paddingTop: 0 }}>
                    <button type="button" className="page-btn" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={!data || data.page <= 1} aria-label="上一页"><ChevronLeft size={14} /></button>
                    {pageNumbers.map((number) => (
                      <button type="button" key={number} className={`page-btn ${data?.page === number ? "active" : ""}`} onClick={() => setPage(number)}>{number}</button>
                    ))}
                    <button type="button" className="page-btn" onClick={() => setPage((value) => Math.min(data?.pageCount || 1, value + 1))} disabled={!data || data.page >= data.pageCount} aria-label="下一页"><ChevronRight size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
      </section>

      {tabs.map((tab) => (
        <section
          key={tab.id}
          className="issue-tab-panel issue-detail-panel"
          hidden={activeTab !== tab.id}
          role="tabpanel"
          aria-label={`条码 ${tab.label} 详情`}
        >
          <div className="card issue-detail-card">
            <IssueDetail
              projectId={projectId}
              barcodeId={tab.id}
              initialLabel={tab.label}
              currentUser={currentUser}
              groups={groups}
              statuses={statuses}
              refreshVersion={detailVersion}
              onCloseTab={() => closeTab(tab.id)}
              onChanged={notifyListChanged}
              onDeleted={(id) => {
                closeTab(id);
                toast.success("条码已删除");
                void loadList();
              }}
            />
          </div>
        </section>
      ))}

      {entryOpen ? (
        <EntryModal
          projectId={projectId}
          groups={groups}
          defaultGroupIds={defaultGroupIds}
          categories={categories}
          onClose={() => setEntryOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}
      {importOpen ? (
        <ImportModal
          projectId={projectId}
          onClose={() => setImportOpen(false)}
          onImported={() => { void loadList(); bumpDetailVersion(); }}
        />
      ) : null}
      {statusOpen ? (
        <StatusModal
          projectId={projectId}
          selection={{ kind: "bulk", barcodeIds: selectedRows.map((row) => row.id), label: `已选 ${selectedRows.length} 个条码（共 ${selectedIssueCount} 个问题项）` }}
          statuses={statuses}
          onClose={() => setStatusOpen(false)}
          onUpdated={(message) => {
            toast.success(message);
            setStatusOpen(false);
            setSelected(new Set());
            bumpDetailVersion();
            void loadList();
          }}
        />
      ) : null}
      {transferOpen ? (
        <TransferModal
          projectId={projectId}
          selection={{ kind: "bulk", barcodeIds: selectedRows.map((row) => row.id), label: `已选 ${selectedRows.length} 个条码（共 ${selectedIssueCount} 个问题项）` }}
          currentGroupIds={currentGroupUnion}
          intraGroupIds={commonGroups}
          groups={groups}
          onClose={() => setTransferOpen(false)}
          onTransferred={(message) => {
            toast.success(message);
            setTransferOpen(false);
            setSelected(new Set());
            bumpDetailVersion();
            void loadList();
          }}
        />
      ) : null}
      {deleteOpen ? (
        <Modal
          title="批量删除条码"
          description={`将处理已选的 ${selectedRows.length} 个条码（${selectedIssueCount} 个问题项）。`}
          size="sm"
          onClose={() => (deletePending ? null : setDeleteOpen(false))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(false)} disabled={deletePending}>取消</button>
            <button type="button" className="btn btn-danger" onClick={() => void deleteSelected()} disabled={deletePending}>{deletePending ? "处理中…" : "确认删除"}</button>
          </>}
        >
          <div className="alert alert-warning">
            <ShieldAlert size={15} />
            <span>没有定位原因且未发生责任人转移的条码会立即删除；存在相关历史的条码将合并为一条审核记录提交项目 PM 审批，审批前不会删除。多选时同一条审核记录包含全部待审条码。</span>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Clock,
  GitBranch,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { PackageStatus, PackagesPayload, PackageOverview } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConclusionBadge, EmptyHint, StatusBadge, VersionText } from "@/components/packages/shared";
import { TestFlow } from "@/components/packages/TestFlow";
import { VerifyFlow } from "@/components/packages/VerifyFlow";
import { HistoryDialog } from "@/components/packages/HistoryDialog";

type TabKey = "overview" | "test" | "verify";

const STATUS_ORDER: PackageStatus[] = [
  "TEST_PENDING",
  "IN_TEST",
  "TEST_PASSED",
  "VERIFY_PENDING",
  "IN_VERIFY",
  "READY",
  "OFFICIAL",
];

export function PackagesWorkspace({
  projectId,
  currentUser,
}: {
  projectId: string;
  currentUser: { id: string; name: string };
}) {
  const toast = useToast();
  const [data, setData] = useState<PackagesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; pkg: PackageOverview } | null>(null);
  const [historyPackage, setHistoryPackage] = useState<{ id: string; code: string } | null>(null);
  const [testerSaving, setTesterSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await apiFetch<PackagesPayload>(`/api/projects/${projectId}/packages`);
      setData(result);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const packages = useMemo(() => {
    if (!data) return [];
    const keyword = search.trim().toLowerCase();
    return data.packages.filter((pkg) => {
      if (keyword && !`${pkg.code} ${pkg.name} ${pkg.ownerName || ""}`.toLowerCase().includes(keyword)) return false;
      if (groupFilter && pkg.groupId !== groupFilter) return false;
      if (statusFilter && pkg.status !== statusFilter) return false;
      return true;
    });
  }, [data, search, groupFilter, statusFilter]);

  const pendingTest = data?.pendingTestRequests.length || 0;
  const pendingVerify = data?.pendingVerifyRequests.length || 0;
  const readyCount = data?.promoteCandidates.length || 0;

  async function saveTesterGroup(groupId: string) {
    setTesterSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/packages/settings`, {
        method: "PATCH",
        body: JSON.stringify({ testerGroupId: groupId || null }),
      });
      toast.success("测试责任组已更新");
      await reload();
    } catch (saveError) {
      toast.error(errorMessage(saveError));
    } finally {
      setTesterSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page-stack packages-page">
        <div className="loading"><span className="spinner" /> 正在加载软件包与版本数据…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-stack packages-page">
        <div className="alert alert-error">{error || "加载失败"}</div>
        <button type="button" className="btn btn-secondary" onClick={() => void reload()}><RefreshCw size={14} /> 重试</button>
      </div>
    );
  }

  return (
    <div className="page-stack packages-page">
      <div className="page-header">
        <div>
          <div className="page-kicker">Release Pipeline</div>
          <h1 className="page-title">软件包管理</h1>
          <p className="page-sub">
            责任组成员提交转测试申请 → 负责人统一组织转测试批次（生成全量配套表）→ 测试责任组给出验收结论 →
            提交人申请转验证 → 负责人组织正式服务器验证（逐包绑定条码）→ 验证通过后统一转正。每次转测/验证都保留完整历史与版本差异。
          </p>
        </div>
        <div className="header-actions">
          <span className="badge badge-outline">
            测试责任组：{data.testerGroup ? data.testerGroup.name : "未设置"}
          </span>
        </div>
      </div>

      <div className="packages-metrics">
        <div className="card metric-card">
          <div className="metric-label"><Package size={15} /> 软件包</div>
          <div className="metric-value">{data.stats.total}</div>
          <div className="metric-note">正式 {data.stats.official} 个 · 待组织转测 {data.stats.pendingTest} 个</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><Clock size={15} /> 测试中</div>
          <div className="metric-value">{data.stats.inTest}</div>
          <div className="metric-note">已纳入转测试批次、等待验收结论</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><GitBranch size={15} /> 验证中</div>
          <div className="metric-value">{data.stats.inVerify}</div>
          <div className="metric-note">正式服务器验证，逐包绑定条码</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><CheckCircle2 size={15} /> 可转正</div>
          <div className="metric-value">{data.stats.ready}</div>
          <div className="metric-note">验证通过，等待转为正式版本</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><Boxes size={15} /> 待办申请</div>
          <div className="metric-value">{pendingTest + pendingVerify}</div>
          <div className="metric-note">转测试 {pendingTest} · 转验证 {pendingVerify}</div>
        </div>
      </div>

      <div className="tabbar packages-tabs" role="tablist" aria-label="软件包管理标签页">
        <button type="button" role="tab" aria-selected={tab === "overview"} className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
          <Package size={14} /> 软件包总览
        </button>
        <button type="button" role="tab" aria-selected={tab === "test"} className={`tab ${tab === "test" ? "active" : ""}`} onClick={() => setTab("test")}>
          <Clock size={14} /> 转测试 {pendingTest ? <span className="tab-count">{pendingTest}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === "verify"} className={`tab ${tab === "verify" ? "active" : ""}`} onClick={() => setTab("verify")}>
          <GitBranch size={14} /> 转验证与转正 {pendingVerify + readyCount ? <span className="tab-count">{pendingVerify + readyCount}</span> : null}
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {tab === "overview" ? (
        <section className="packages-panel" role="tabpanel" aria-label="软件包总览">
          <div className="card">
            <div className="card-header packages-overview-head">
              <div>
                <h2 className="section-title">软件包版本总览</h2>
                <div className="section-sub">正式版本来自正式服务器；测试版本/验证版本为最近一次纳入对应批次的版本。点击「历史」查看完整流转。</div>
              </div>
              <div className="header-actions">
                {data.permissions.canManage ? (
                  <button type="button" className="btn btn-primary" onClick={() => setEditor({ mode: "create" })}>
                    <Plus size={14} /> 新增软件包
                  </button>
                ) : null}
              </div>
            </div>

            <div className="card-body packages-filter-bar">
              <div className="field" style={{ position: "relative", maxWidth: 280 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)" }} />
                <input className="input" style={{ paddingLeft: 32 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索编码 / 名称 / 责任人" />
              </div>
              <div className="field" style={{ maxWidth: 180 }}>
                <select className="select" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} aria-label="按责任组筛选">
                  <option value="">全部责任组</option>
                  {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ maxWidth: 170 }}>
                <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按状态筛选">
                  <option value="">全部状态</option>
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {data.packages.find((pkg) => pkg.status === status)?.statusLabel || status}
                    </option>
                  ))}
                </select>
              </div>
              <span className="spacer" />
              <span className="hint">{packages.length} / {data.packages.length} 个软件包</span>
              <button type="button" className="icon-btn" onClick={() => void reload()} title="刷新"><RefreshCw size={14} /></button>
            </div>

            <div className="table-wrap">
              <table className="table packages-table">
                <thead>
                  <tr>
                    <th>软件包编码 / 名称</th>
                    <th>责任组</th>
                    <th>负责人</th>
                    <th>正式版本</th>
                    <th>验证版本</th>
                    <th>测试版本</th>
                    <th>当前状态</th>
                    <th>最近结论</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {packages.length === 0 ? (
                    <tr><td colSpan={9}><EmptyHint title="没有匹配的软件包" description={data.packages.length === 0 ? "先在基础信息中维护软件包？现在请在本页「新增软件包」维护编码清单。" : "尝试调整筛选条件。"} /></td></tr>
                  ) : packages.map((pkg) => (
                    <tr key={pkg.id}>
                      <td>
                        <div className="main-cell mono">{pkg.code}</div>
                        <div className="cell-sub">{pkg.name && pkg.name !== pkg.code ? pkg.name : "—"}</div>
                      </td>
                      <td>{pkg.groupName ? <span className="chip">{pkg.groupName}</span> : <span className="hint">未分配</span>}</td>
                      <td>{pkg.ownerName || <span className="hint">—</span>}</td>
                      <td><VersionText value={pkg.officialVersion} /></td>
                      <td><VersionText value={pkg.verificationVersion} /></td>
                      <td><VersionText value={pkg.testVersion} /></td>
                      <td><StatusBadge status={pkg.status} label={pkg.statusLabel} /></td>
                      <td>
                        <div className="conclusion-stack">
                          {pkg.lastTestConclusion ? (
                            <span className="conclusion-line">
                              <span className="hint">测试</span>
                              <ConclusionBadge conclusion={pkg.lastTestConclusion} />
                              {pkg.lastTestBatchCode ? <span className="mini-meta mono">{pkg.lastTestBatchCode}</span> : null}
                            </span>
                          ) : null}
                          {pkg.lastVerifyConclusion ? (
                            <span className="conclusion-line">
                              <span className="hint">验证</span>
                              <ConclusionBadge conclusion={pkg.lastVerifyConclusion} />
                              {pkg.lastVerifyBatchCode ? <span className="mini-meta mono">{pkg.lastVerifyBatchCode}</span> : null}
                            </span>
                          ) : null}
                          {!pkg.lastTestConclusion && !pkg.lastVerifyConclusion ? <span className="hint">—</span> : null}
                        </div>
                      </td>
                      <td className="actions">
                        <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistoryPackage({ id: pkg.id, code: pkg.code })}>
                            历史
                          </button>
                          {data.permissions.canManage ? (
                            <>
                              <button type="button" className="icon-btn" title="编辑软件包" onClick={() => setEditor({ mode: "edit", pkg })}><Pencil size={13} /></button>
                              <button
                                type="button"
                                className="icon-btn danger"
                                title="删除软件包"
                                onClick={async () => {
                                  if (!window.confirm(`确定删除软件包「${pkg.code}」吗？已有转测/验证记录时会被拒绝。`)) return;
                                  try {
                                    await apiFetch(`/api/projects/${projectId}/packages/${pkg.id}`, { method: "DELETE" });
                                    toast.success("软件包已删除");
                                    await reload();
                                  } catch (deleteError) {
                                    toast.error(errorMessage(deleteError));
                                  }
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad packages-settings">
            <div className="packages-settings-row">
              <div>
                <h2 className="section-title">测试责任组</h2>
                <div className="section-sub">该责任组成员负责查看转测试配套表并给出验收结论；同时可组织转测试/转验证批次。</div>
              </div>
              <span className="spacer" />
              {data.permissions.canManage ? (
                <select
                  className="select"
                  style={{ maxWidth: 220 }}
                  value={data.testerGroup?.id || ""}
                  disabled={testerSaving}
                  onChange={(event) => void saveTesterGroup(event.target.value)}
                  aria-label="测试责任组"
                >
                  <option value="">未设置</option>
                  {data.groups.filter((group) => group.enabled).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              ) : (
                <span className="badge badge-outline">{data.testerGroup ? data.testerGroup.name : "未设置"}</span>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "test" ? (
        <TestFlow projectId={projectId} payload={data} currentUserId={currentUser.id} onChanged={reload} />
      ) : null}

      {tab === "verify" ? (
        <VerifyFlow projectId={projectId} payload={data} onChanged={reload} />
      ) : null}

      {editor ? (
        <PackageEditorModal
          projectId={projectId}
          payload={data}
          target={editor.mode === "edit" ? editor.pkg : null}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await reload();
          }}
        />
      ) : null}

      {historyPackage ? (
        <HistoryDialog projectId={projectId} packageId={historyPackage.id} packageCode={historyPackage.code} onClose={() => setHistoryPackage(null)} />
      ) : null}
    </div>
  );
}

function PackageEditorModal({
  projectId,
  payload,
  target,
  onClose,
  onSaved,
}: {
  projectId: string;
  payload: PackagesPayload;
  target: PackageOverview | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [code, setCode] = useState(target?.code || "");
  const [description, setDescription] = useState(target && target.name !== target.code ? target.name : "");
  const [version, setVersion] = useState(target?.officialVersion || "");
  const [groupId, setGroupId] = useState(target?.groupId || "");
  const [ownerId, setOwnerId] = useState(target?.ownerId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (target) {
        await apiFetch(`/api/projects/${projectId}/packages/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ code, description, version, groupId: groupId || null, ownerId: ownerId || null }),
        });
        toast.success("软件包已更新");
      } else {
        await apiFetch(`/api/projects/${projectId}/packages`, {
          method: "POST",
          body: JSON.stringify({ code, description, version, groupId: groupId || null, ownerId: ownerId || null }),
        });
        toast.success("软件包已创建");
      }
      await onSaved();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={target ? `编辑软件包 · ${target.code}` : "新增软件包"}
      description="编码即软件包名，正式版本用于配套表对比。"
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !code.trim()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </>
      )}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <div className="field">
          <label>软件包编码（包名）</label>
          <input className="input mono" value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} placeholder="XH-CPU-2601" />
        </div>
        <div className="field">
          <label>正式版本</label>
          <input className="input mono" value={version} onChange={(event) => setVersion(event.target.value)} maxLength={50} placeholder="Rev.B2" />
        </div>
        <div className="field">
          <label>说明</label>
          <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="软件包用途 / 描述" />
        </div>
        <div className="field">
          <label>责任组</label>
          <select className="select" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">未分配</option>
            {payload.groups.filter((group) => group.enabled).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>负责人</label>
          <select className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">未指定</option>
            {payload.members.map((member) => <option key={member.id} value={member.id}>{member.name}（{member.employeeNo}）</option>)}
          </select>
        </div>
      </div>
      <div className="field-hint" style={{ marginTop: 10 }}>
        正式版本由转正动作自动更新；手工修改仅用于初始化或纠错。
      </div>
    </Modal>
  );
}

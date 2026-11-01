"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, ChevronDown, ChevronUp, Clock, ShieldCheck, Undo2 } from "lucide-react";
import type { BatchItemView, PackagesPayload } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { BarcodeEditor, ChangeFlag, ConclusionBadge, ConclusionModal, EmptyHint, VersionText } from "@/components/packages/shared";
import { OrganizeBatchModal } from "@/components/packages/TestFlow";
import { RequestModal } from "@/components/packages/RequestModal";

export function VerifyFlow({
  projectId,
  payload,
  onChanged,
}: {
  projectId: string;
  payload: PackagesPayload;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { permissions, verifyRequestCandidates, pendingVerifyRequests, verifyBatches } = payload;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);
  const [requestSource, setRequestSource] = useState<BatchItemView | null>(null);
  const [concluding, setConcluding] = useState<{ batchId: string; item: BatchItemView } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(verifyBatches[0] ? [verifyBatches[0].id] : []));
  const [barcodeDraft, setBarcodeDraft] = useState<Record<string, string[]>>({});
  const [promotedPick, setPromotedPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const selectableIds = pendingVerifyRequests.map((request) => request.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const candidates = useMemo(() => verifyRequestCandidates, [verifyRequestCandidates]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBatch(batchId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }

  async function cancelRequest(requestId: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/package-requests`, {
        method: "PATCH",
        body: JSON.stringify({ requestId, action: "cancel" }),
      });
      toast.success("申请已撤回");
      await onChanged();
    } catch (cancelError) {
      toast.error(errorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  }

  async function saveBarcodes(batchId: string, item: BatchItemView) {
    const barcodes = barcodeDraft[item.id] ?? item.barcodes;
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${projectId}/package-batches/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "barcodes", itemId: item.id, barcodes }),
      });
      toast.success(`${item.packageCode} 的验证条码已保存`);
      setBarcodeDraft((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await onChanged();
    } catch (saveError) {
      toast.error(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function promote(batchId: string) {
    const itemIds = [...promotedPick];
    if (itemIds.length === 0) return;
    if (!window.confirm(`确认将选中的 ${itemIds.length} 个软件包转为正式版本？正式版本号将被更新，操作会记录在历史中。`)) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ promoted: number }>(`/api/projects/${projectId}/package-batches/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "promote", itemIds }),
      });
      toast.success(`已将 ${result.promoted} 个软件包转为正式版本`);
      setPromotedPick(new Set());
      await onChanged();
    } catch (promoteError) {
      toast.error(errorMessage(promoteError));
    } finally {
      setBusy(false);
    }
  }

  function togglePromote(id: string) {
    setPromotedPick((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="packages-panel" role="tabpanel" aria-label="转验证与转正">
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">测试通过 · 待提交转验证</h2>
            <div className="section-sub">测试结论为「通过」的转测记录可提交转验证申请；提交人默认为原转测申请人，责任组负责人与 PM/主管也可提交。</div>
          </div>
          <span className="badge badge-outline">{candidates.length} 个可申请</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>软件包</th>
                <th>责任组</th>
                <th>测试版本</th>
                <th>测试结论</th>
                <th>申请人</th>
                <th>修改内容</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr><td colSpan={7}><EmptyHint title="暂无测试通过待转验证的软件包" description="测试责任组在「转测试」页给出通过结论后，这里会自动出现可申请记录。" /></td></tr>
              ) : candidates.map((item) => (
                <tr key={item.id}>
                  <td><div className="main-cell mono">{item.packageCode}</div></td>
                  <td>{item.groupName ? <span className="chip">{item.groupName}</span> : <span className="hint">未分配</span>}</td>
                  <td><VersionText value={item.version} /></td>
                  <td><ConclusionBadge conclusion={item.conclusion} /></td>
                  <td>{item.submittedByName || <span className="hint">—</span>}</td>
                  <td className="wrap-cell">{item.changeSummary || <span className="hint">—</span>}</td>
                  <td className="actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setRequestSource(item)}>
                      提交转验证申请
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">待组织转验证的申请</h2>
            <div className="section-sub">负责人勾选后统一组织为转验证批次，进入正式服务器验证；每个软件包可绑定多个验证条码。</div>
          </div>
          <div className="header-actions">
            <span className="badge badge-outline">{pendingVerifyRequests.length} 个待组织</span>
            {permissions.canOrganize ? (
              <button type="button" className="btn btn-primary" disabled={selected.size === 0} onClick={() => setOrganizing(true)}>
                <BadgeCheck size={14} /> 组织转验证{selected.size ? `（${selected.size}）` : ""}
              </button>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {permissions.canOrganize ? (
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      className="issue-check"
                      checked={allSelected}
                      onChange={(event) => setSelected(event.target.checked ? new Set(selectableIds) : new Set())}
                      aria-label="全选待组织验证申请"
                    />
                  </th>
                ) : null}
                <th>软件包</th>
                <th>责任组</th>
                <th>申请版本</th>
                <th>说明</th>
                <th>申请人</th>
                <th>提交时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingVerifyRequests.length === 0 ? (
                <tr><td colSpan={permissions.canOrganize ? 8 : 7}><EmptyHint title="暂无待组织的转验证申请" description="在上一节选择测试通过的软件包提交转验证申请。" /></td></tr>
              ) : pendingVerifyRequests.map((request) => (
                <tr key={request.id}>
                  {permissions.canOrganize ? (
                    <td className="check-cell">
                      <input type="checkbox" className="issue-check" checked={selected.has(request.id)} onChange={() => toggle(request.id)} aria-label={`选择 ${request.packageCode}`} />
                    </td>
                  ) : null}
                  <td><div className="main-cell mono">{request.packageCode}</div></td>
                  <td>{request.groupName ? <span className="chip">{request.groupName}</span> : <span className="hint">未分配</span>}</td>
                  <td><VersionText value={request.version} /></td>
                  <td className="wrap-cell">{request.changeSummary || <span className="hint">—</span>}</td>
                  <td>{request.submittedByName}</td>
                  <td className="mini-meta">{request.submittedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="actions">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void cancelRequest(request.id)}>
                      <Undo2 size={12} /> 撤回
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">转验证批次 · 正式服务器验证</h2>
            <div className="section-sub">为每个软件包绑定验证条码并给出验证结论；验证通过后可勾选转正，正式版本号会同步更新并写入历史。</div>
          </div>
          <span className="badge badge-outline">{verifyBatches.length} 批</span>
        </div>
        <div className="batch-list">
          {verifyBatches.length === 0 ? (
            <EmptyHint title="还没有转验证批次" description="测试通过并提交转验证申请后，由负责人组织第一批转验证。" />
          ) : verifyBatches.map((batch) => {
            const open = expanded.has(batch.id);
            const promotable = batch.items.filter((item) => item.conclusion === "PASS" && !item.promoted);
            return (
              <div key={batch.id} className={`batch-card ${open ? "open" : ""}`}>
                <div className="batch-head-row">
                  <button type="button" className="batch-head" onClick={() => toggleBatch(batch.id)} aria-expanded={open}>
                    <span className="batch-code mono">{batch.code}</span>
                    <span className="batch-title">{batch.title || "转验证批次"}</span>
                    <span className="batch-meta"><Clock size={12} /> {batch.scheduledDate || batch.createdAt.slice(0, 10)} · {batch.createdByName}</span>
                    <span className={`badge ${batch.status === "DONE" ? "badge-green" : "badge-blue"}`}>
                      {batch.status === "DONE" ? "已验证" : `待结论 ${batch.summary.pending}`}
                    </span>
                    <span className="batch-stats">
                      验证 {batch.transferredCount} · 通过 {batch.summary.pass} · 不通过 {batch.summary.fail} · 有条件 {batch.summary.conditional}
                    </span>
                    {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {permissions.canPromote ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy || promotedPick.size === 0}
                      onClick={() => void promote(batch.id)}
                    >
                      <ShieldCheck size={13} /> 转正所选{promotedPick.size ? `（${promotedPick.size}）` : ""}
                    </button>
                  ) : null}
                </div>
                {open ? (
                  <div className="table-wrap">
                    <table className="table packages-matrix">
                      <thead>
                        <tr>
                          <th>软件包</th>
                          <th>责任组</th>
                          <th>版本</th>
                          <th>较正式</th>
                          <th>验证条码</th>
                          <th>验证结论</th>
                          <th>转正</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.items.map((item) => {
                          const draft = barcodeDraft[item.id];
                          const edited = Array.isArray(draft);
                          const canPromoteRow = permissions.canPromote && item.conclusion === "PASS" && !item.promoted;
                          return (
                            <tr key={item.id}>
                              <td>
                                <div className="main-cell mono">{item.packageCode}</div>
                                {item.changeSummary ? <div className="cell-sub wrap-cell">{item.changeSummary}</div> : null}
                              </td>
                              <td>{item.groupName ? <span className="chip">{item.groupName}</span> : <span className="hint">未分配</span>}</td>
                              <td><VersionText value={item.version} /></td>
                              <td><ChangeFlag changed={item.updatedVsOfficial} title={`正式版本：${item.officialVersion || "—"}`} /></td>
                              <td className="barcode-cell">
                                <BarcodeEditor
                                  value={edited ? draft : item.barcodes}
                                  disabled={!permissions.canConclude && !permissions.canOrganize}
                                  onChange={(next) => setBarcodeDraft((current) => ({ ...current, [item.id]: next }))}
                                />
                                {edited ? (
                                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveBarcodes(batch.id, item)}>
                                    保存条码
                                  </button>
                                ) : null}
                              </td>
                              <td>
                                <div className="conclusion-cell">
                                  <ConclusionBadge conclusion={item.conclusion} />
                                  {item.conclusionNote ? <div className="cell-sub">{item.conclusionNote}</div> : null}
                                  {item.concludedByName ? <div className="cell-sub">by {item.concludedByName}</div> : null}
                                  {permissions.canConclude ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setConcluding({ batchId: batch.id, item })}
                                    >
                                      {item.conclusion === "PENDING" ? "录入结论" : "修改结论"}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                {item.promoted ? (
                                  <span className="badge badge-green">已转正</span>
                                ) : canPromoteRow ? (
                                  <label className="promote-check">
                                    <input
                                      type="checkbox"
                                      className="issue-check"
                                      checked={promotedPick.has(item.id)}
                                      onChange={() => togglePromote(item.id)}
                                      aria-label={`选择转正 ${item.packageCode}`}
                                    />
                                    待转正
                                  </label>
                                ) : (
                                  <span className="hint">{item.conclusion === "PASS" ? "—" : "需验证通过"}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {promotable.length > 0 && permissions.canPromote ? (
                      <div className="batch-foot-hint">
                        本批有 {promotable.length} 个软件包验证通过待转正：{promotable.map((item) => item.packageCode).join("、")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {requestSource ? (
        <RequestModal
          projectId={projectId}
          payload={payload}
          kind="VERIFY"
          sourceItem={requestSource}
          onClose={() => setRequestSource(null)}
          onCreated={async () => {
            setRequestSource(null);
            toast.success("转验证申请已提交，等待负责人组织验证");
            await onChanged();
          }}
        />
      ) : null}

      {organizing ? (
        <OrganizeBatchModal
          projectId={projectId}
          kind="VERIFY"
          requests={pendingVerifyRequests.filter((request) => selected.has(request.id))}
          onClose={() => setOrganizing(false)}
          onCreated={async (code) => {
            setOrganizing(false);
            setSelected(new Set());
            toast.success(`已组织转验证批次 ${code}`);
            await onChanged();
          }}
        />
      ) : null}

      {concluding ? (
        <ConclusionModal
          projectId={projectId}
          batchId={concluding.batchId}
          kind="VERIFY"
          item={concluding.item}
          onClose={() => setConcluding(null)}
          onSaved={async () => {
            setConcluding(null);
            toast.success("验证结论已保存");
            await onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

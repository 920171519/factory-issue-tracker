"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Clock, ExternalLink, LoaderCircle, Undo2 } from "lucide-react";
import type { BatchItemView, BatchView, PackagesPayload } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { formatDateTime } from "@/lib/time";
import { ChangeFlag, ConclusionBadge, ConclusionModal, EmptyHint, VersionText } from "@/components/packages/shared";
import { RequestModal } from "@/components/packages/RequestModal";

export function TestFlow({
  projectId,
  payload,
  currentUserId,
  onChanged,
}: {
  projectId: string;
  payload: PackagesPayload;
  currentUserId: string;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const { permissions, pendingTestRequests, testBatches } = payload;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(testBatches[0] ? [testBatches[0].id] : []));
  const [concluding, setConcluding] = useState<{ batch: BatchView; item: BatchItemView } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectableIds = pendingTestRequests.map((request) => request.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

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

  return (
    <section className="packages-panel" role="tabpanel" aria-label="转测试">
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">待组织转测的软件包</h2>
            <div className="section-sub">责任组成员提交的转测试申请。负责人可勾选后统一组织为一个转测试批次，并自动生成全量配套表。</div>
          </div>
          <div className="header-actions">
            <span className="badge badge-outline">{pendingTestRequests.length} 个待组织</span>
            <button type="button" className="btn btn-secondary" onClick={() => setRequesting(true)}>
              <Clock size={14} /> 提交转测试申请
            </button>
            {permissions.canOrganize ? (
              <button type="button" className="btn btn-primary" disabled={selected.size === 0} onClick={() => setOrganizing(true)}>
                <CalendarClock size={14} /> 组织转测试{selected.size ? `（${selected.size}）` : ""}
              </button>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table packages-request-table">
            <thead>
              <tr>
                {permissions.canOrganize ? (
                  <th className="check-cell">
                    <input
                      type="checkbox"
                      className="issue-check"
                      checked={allSelected}
                      onChange={(event) => setSelected(event.target.checked ? new Set(selectableIds) : new Set())}
                      aria-label="全选待组织申请"
                    />
                  </th>
                ) : null}
                <th>软件包</th>
                <th>责任组</th>
                <th>申请版本</th>
                <th>修改内容</th>
                <th>存放链接</th>
                <th>申请人</th>
                <th>提交时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingTestRequests.length === 0 ? (
                <tr><td colSpan={permissions.canOrganize ? 9 : 8}><EmptyHint title="暂无待组织的转测试申请" description="责任组成员可在「转测试」页提交申请，填写软件包、修改内容与存放链接。" /></td></tr>
              ) : pendingTestRequests.map((request) => (
                <tr key={request.id}>
                  {permissions.canOrganize ? (
                    <td className="check-cell">
                      <input type="checkbox" className="issue-check" checked={selected.has(request.id)} onChange={() => toggle(request.id)} aria-label={`选择 ${request.packageCode}`} />
                    </td>
                  ) : null}
                  <td>
                    <div className="main-cell mono">{request.packageCode}</div>
                    <div className="cell-sub">{request.packageName || "—"}</div>
                  </td>
                  <td>{request.groupName ? <span className="chip">{request.groupName}</span> : <span className="hint">未分配</span>}</td>
                  <td><VersionText value={request.version} /></td>
                  <td className="wrap-cell">{request.changeSummary || <span className="hint">—</span>}</td>
                  <td>{request.packageUrl ? <a className="link" href={request.packageUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> 打开</a> : <span className="hint">—</span>}</td>
                  <td>{request.submittedByName}</td>
                  <td className="mini-meta mono">{formatDateTime(request.submittedAt, { seconds: true })}</td>
                  <td className="actions">
                    {(permissions.canManage || permissions.canPromote || request.submittedBy === currentUserId) ? (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void cancelRequest(request.id)}>
                        <Undo2 size={12} /> 撤回
                      </button>
                    ) : null}
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
            <h2 className="section-title">转测试批次与配套表</h2>
            <div className="section-sub">
              每批配套表列出全部软件包；转测包取申请版本，其余包保持正式版本。「较正式」表示版本不同于正式服务器，「较上批」表示版本不同于上一次转测批次。
            </div>
          </div>
          <span className="badge badge-outline">{testBatches.length} 批</span>
        </div>
        <div className="batch-list">
          {testBatches.length === 0 ? (
            <EmptyHint title="还没有转测试批次" description="勾选待组织申请后点击「组织转测试」，系统会生成第一批配套表。" />
          ) : testBatches.map((batch) => {
            const open = expanded.has(batch.id);
            const items = batch.items;
            return (
              <div key={batch.id} className={`batch-card ${open ? "open" : ""}`}>
                <button type="button" className="batch-head" onClick={() => toggleBatch(batch.id)} aria-expanded={open}>
                  <span className="batch-code mono">{batch.code}</span>
                  <span className="batch-title">{batch.title || "转测试批次"}</span>
                  <span className="batch-meta"><Clock size={12} /> 组织 {formatDateTime(batch.createdAt, { seconds: true })} · {batch.createdByName}</span>
                  <span className={`badge ${batch.status === "DONE" ? "badge-green" : "badge-blue"}`}>
                    {batch.status === "DONE" ? "已出结论" : `待结论 ${batch.summary.pending}`}
                  </span>
                  <span className="batch-stats">
                    转测 {batch.transferredCount} · 通过 {batch.summary.pass} · 不通过 {batch.summary.fail} · 有条件 {batch.summary.conditional}
                  </span>
                  {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {open ? (
                  <div className="table-wrap">
                    <table className="table packages-matrix">
                      <thead>
                        <tr>
                          <th className="row-number">#</th>
                          <th>软件包</th>
                          <th>责任组</th>
                          <th>正式版本</th>
                          <th>本批版本</th>
                          <th>较正式</th>
                          <th>较上批</th>
                          <th>申请 / 修改内容</th>
                          <th>测试结论</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={item.id} className={item.isTransferred ? "transferred-row" : ""}>
                            <td className="row-number">{index + 1}</td>
                            <td>
                              <div className="main-cell mono">{item.packageCode}</div>
                              {item.packageName && item.packageName !== item.packageCode ? <div className="cell-sub">{item.packageName}</div> : null}
                            </td>
                            <td>{item.groupName ? <span className="chip">{item.groupName}</span> : <span className="hint">未分配</span>}</td>
                            <td><VersionText value={item.officialVersion} /></td>
                            <td><VersionText value={item.version} /></td>
                            <td><ChangeFlag changed={item.updatedVsOfficial} title={item.isTransferred ? "本批转测版本与正式版本不同" : "随配套表下发正式版本"} /></td>
                            <td>
                              <ChangeFlag
                                changed={item.updatedVsPrevious}
                                title={`上一批版本：${item.previousVersion || "—"}`}
                              />
                            </td>
                            <td className="wrap-cell">
                              {item.isTransferred ? (
                                <>
                                  <div>{item.changeSummary || "—"}</div>
                                  <div className="cell-sub">
                                    {item.submittedByName || "—"}
                                    {item.submittedAt ? <> · {formatDateTime(item.submittedAt, { seconds: true })}</> : null}
                                    {item.packageUrl ? <> · <a className="link" href={item.packageUrl} target="_blank" rel="noreferrer">存放链接<ExternalLink size={11} /></a></> : null}
                                  </div>
                                </>
                              ) : <span className="hint">未变更（随正式版本）</span>}
                            </td>
                            <td>
                              {item.isTransferred ? (
                                <div className="conclusion-cell">
                                  <ConclusionBadge conclusion={item.conclusion} />
                                  {item.conclusionNote ? <div className="cell-sub">{item.conclusionNote}</div> : null}
                                  {item.concludedByName ? <div className="cell-sub">by {item.concludedByName}</div> : null}
                                </div>
                              ) : <span className="hint">—</span>}
                            </td>
                            <td className="actions">
                              {item.isTransferred && permissions.canConclude ? (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConcluding({ batch, item })}>
                                  {item.conclusion === "PENDING" ? "录入结论" : "修改结论"}
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {organizing ? (
        <OrganizeBatchModal
          projectId={projectId}
          kind="TEST"
          requests={pendingTestRequests.filter((request) => selected.has(request.id))}
          onClose={() => setOrganizing(false)}
          onCreated={async (code) => {
            setOrganizing(false);
            setSelected(new Set());
            toast.success(`已组织转测试批次 ${code}`);
            await onChanged();
          }}
        />
      ) : null}

      {requesting ? (
        <RequestModal
          projectId={projectId}
          payload={payload}
          kind="TEST"
          onClose={() => setRequesting(false)}
          onCreated={async () => {
            setRequesting(false);
            toast.success("转测试申请已提交，等待负责人组织批次");
            await onChanged();
          }}
        />
      ) : null}

      {concluding ? (
        <ConclusionModal
          projectId={projectId}
          batchId={concluding.batch.id}
          kind="TEST"
          item={concluding.item}
          onClose={() => setConcluding(null)}
          onSaved={async () => {
            setConcluding(null);
            toast.success("测试结论已保存");
            await onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

export function OrganizeBatchModal({
  projectId,
  kind,
  requests,
  onClose,
  onCreated,
}: {
  projectId: string;
  kind: "TEST" | "VERIFY";
  requests: { id: string; packageCode: string; version: string }[];
  onClose: () => void;
  onCreated: (code: string) => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState(formatDateTime(new Date(), { dateOnly: true }));
  const [note, setNote] = useState("");
  const [barcodeDraft, setBarcodeDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function parseBarcodes(value: string): string[] {
    return [...new Set(value.split(/[\s,，;；]+/).map((entry) => entry.trim()).filter(Boolean))];
  }

  const missingBarcode = kind === "VERIFY" && requests.some((request) => parseBarcodes(barcodeDraft[request.id] || "").length === 0);

  async function submit() {
    setError("");
    if (kind === "VERIFY" && missingBarcode) {
      setError("组织转验证时必须为每个软件包填写至少一个验证条码");
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{ batchId: string; code: string }>(`/api/projects/${projectId}/package-batches`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          requestIds: requests.map((request) => request.id),
          title,
          scheduledDate,
          note,
          barcodes: kind === "VERIFY"
            ? requests.map((request) => ({ requestId: request.id, barcodes: parseBarcodes(barcodeDraft[request.id] || "") }))
            : undefined,
        }),
      });
      await onCreated(result.code);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={kind === "TEST" ? "组织转测试批次" : "组织转验证批次"}
      description={kind === "TEST"
        ? "将生成该批次的全量配套表，并记录相较正式版本与上一批转测版本的差异。"
        : "纳入正式服务器验证清单，并为每个软件包填写验证条码（后续可按条码跟踪验证结论）。"}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || requests.length === 0 || missingBarcode}>
            {busy ? <><LoaderCircle size={13} className="spin" /> 生成中…</> : "确认组织"}
          </button>
        </>
      )}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="organize-summary">
        <span className="hint">本次纳入 {requests.length} 个软件包：</span>
        <div className="chip-list" style={{ marginTop: 6 }}>
          {requests.map((request) => (
            <span key={request.id} className="chip mono">{request.packageCode} · {request.version}</span>
          ))}
        </div>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label>批次标题</label>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="例如：11 月第一次转测" />
        </div>
        <div className="field">
          <label>组织日期</label>
          <input className="input" type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} />
        </div>
        {kind === "VERIFY" ? (
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>验证条码（每个软件包至少一个，多个用逗号分隔）</label>
            <div className="organize-barcodes">
              {requests.map((request) => (
                <div key={request.id} className="organize-barcode-row">
                  <span className="mono">{request.packageCode}</span>
                  <span className="hint">{request.version}</span>
                  <input
                    className="input mono"
                    value={barcodeDraft[request.id] || ""}
                    onChange={(event) => setBarcodeDraft((current) => ({ ...current, [request.id]: event.target.value }))}
                    placeholder="例如 XH-CPU-2601001,XH-MIX-2601003"
                    aria-label={`${request.packageCode} 的验证条码`}
                  />
                </div>
              ))}
            </div>
            <div className="field-hint">组织后即可在验证批次中按条码记录验证结论；未填条码无法组织。</div>
          </div>
        ) : null}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>说明</label>
          <textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="本批次的验证范围、注意事项等（可选）" />
        </div>
      </div>
    </Modal>
  );
}

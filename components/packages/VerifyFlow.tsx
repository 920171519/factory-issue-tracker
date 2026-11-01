"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Barcode, ExternalLink, FileText, ShieldCheck, Undo2 } from "lucide-react";
import type { BatchItemView, PackagesPayload, RequestView, VerificationView } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConclusionBadge, ConclusionModal, EmptyHint, VersionText } from "@/components/packages/shared";
import { RequestModal } from "@/components/packages/RequestModal";
import { formatDateTime } from "@/lib/time";

export function VerifyFlow({
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
  const { permissions, verifyRequestCandidates, pendingVerifyRequests, verifications } = payload;
  const [requestSource, setRequestSource] = useState<BatchItemView | null>(null);
  const [handlingRequest, setHandlingRequest] = useState<RequestView | null>(null);
  const [editingVerification, setEditingVerification] = useState<VerificationView | null>(null);
  const [concluding, setConcluding] = useState<VerificationView | null>(null);
  const [promotedPick, setPromotedPick] = useState<Set<string>>(new Set());
  const [barcodeSearch, setBarcodeSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => verifyRequestCandidates, [verifyRequestCandidates]);
  const ledgerEntries = useMemo(() => {
    const keyword = barcodeSearch.trim().toLowerCase();
    if (!keyword) return payload.barcodeLedger;
    return payload.barcodeLedger.filter((entry) =>
      `${entry.barcode} ${entry.packageCode} ${entry.version || ""} ${entry.processUrl || ""}`.toLowerCase().includes(keyword),
    );
  }, [payload.barcodeLedger, barcodeSearch]);

  function canSubmitVerify(item: BatchItemView): boolean {
    if (permissions.canSubmitAny) return true;
    if (item.groupId && permissions.groupIds.includes(item.groupId)) return true;
    return item.submittedById === currentUserId;
  }

  function canCancel(request: RequestView): boolean {
    return permissions.isPm || permissions.isSupervisor || request.submittedBy === currentUserId;
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

  async function promote(verificationIds: string[]) {
    if (verificationIds.length === 0) return;
    if (!window.confirm(`确认将选中的 ${verificationIds.length} 个软件包转为正式版本？正式版本号会被更新，操作记录在历史中。`)) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ promoted: number }>(`/api/projects/${projectId}/package-verifications`, {
        method: "PATCH",
        body: JSON.stringify({ action: "promote", verificationIds }),
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
            <div className="section-sub">测试结论为「通过」的转测记录可提交转验证申请；提交人默认为原转测申请人，该包责任组成员与 PM/主管/软件经理也可提交。</div>
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
                    {canSubmitVerify(item) ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setRequestSource(item)}>
                        提交转验证申请
                      </button>
                    ) : (
                      <span className="hint">仅该责任组成员或申请人可申请</span>
                    )}
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
            <h2 className="section-title">待处理的转验证申请</h2>
            <div className="section-sub">软件经理、项目 PM、项目主管逐包处理：填写电子流程链接与验证条码后，该包进入正式服务器验证。</div>
          </div>
          <span className="badge badge-outline">{pendingVerifyRequests.length} 个待处理</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
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
                <tr><td colSpan={7}><EmptyHint title="暂无待处理的转验证申请" description="在上一节选择测试通过的软件包提交转验证申请。" /></td></tr>
              ) : pendingVerifyRequests.map((request) => (
                <tr key={request.id}>
                  <td><div className="main-cell mono">{request.packageCode}</div></td>
                  <td>{request.groupName ? <span className="chip">{request.groupName}</span> : <span className="hint">未分配</span>}</td>
                  <td><VersionText value={request.version} /></td>
                  <td className="wrap-cell">{request.changeSummary || <span className="hint">—</span>}</td>
                  <td>{request.submittedByName}</td>
                  <td className="mini-meta mono">{formatDateTime(request.submittedAt, { seconds: true })}</td>
                  <td className="actions">
                    <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                      {canCancel(request) ? (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void cancelRequest(request.id)}>
                          <Undo2 size={12} /> 撤回
                        </button>
                      ) : null}
                      {permissions.canHandleVerification ? (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setHandlingRequest(request)}>
                          处理
                        </button>
                      ) : null}
                    </div>
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
            <h2 className="section-title">转验证记录（逐包）</h2>
            <div className="section-sub">每个软件包单独验证：电子流程链接 + 验证条码 + 验证结论；验证通过后可转正，正式版本号同步更新。</div>
          </div>
          <div className="header-actions">
            <span className="badge badge-outline">{verifications.length} 个记录</span>
            {permissions.canPromote ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || promotedPick.size === 0}
                onClick={() => void promote([...promotedPick])}
              >
                <ShieldCheck size={13} /> 转正所选{promotedPick.size ? `（${promotedPick.size}）` : ""}
              </button>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table className="table packages-matrix">
            <thead>
              <tr>
                <th>软件包</th>
                <th>责任组</th>
                <th>验证版本</th>
                <th>电子流程</th>
                <th>验证条码</th>
                <th>验证结论</th>
                <th>处理 / 结论人</th>
                <th>转正</th>
              </tr>
            </thead>
            <tbody>
              {verifications.length === 0 ? (
                <tr><td colSpan={8}><EmptyHint title="还没有转验证记录" description="软件经理处理「待处理的转验证申请」后，会在这里生成逐包验证记录。" /></td></tr>
              ) : verifications.map((verification) => {
                const canPromoteRow = permissions.canPromote && verification.conclusion === "PASS" && !verification.promoted;
                return (
                  <tr key={verification.id}>
                    <td>
                      <div className="main-cell mono">{verification.packageCode}</div>
                      {verification.packageName && verification.packageName !== verification.packageCode ? <div className="cell-sub">{verification.packageName}</div> : null}
                    </td>
                    <td>{verification.groupName ? <span className="chip">{verification.groupName}</span> : <span className="hint">未分配</span>}</td>
                    <td><VersionText value={verification.version} /></td>
                    <td>
                      {verification.processUrl ? (
                        <a className="link" href={verification.processUrl} target="_blank" rel="noreferrer"><FileText size={12} /> 电子流程</a>
                      ) : (
                        <span className="hint">未填写</span>
                      )}
                      {permissions.canHandleVerification && !verification.promoted ? (
                        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingVerification(verification)}>编辑</button></div>
                      ) : null}
                    </td>
                    <td className="barcode-cell">
                      {verification.barcodes.length === 0 ? <span className="hint">—</span> : (
                        <div className="chip-list">
                          {verification.barcodes.map((barcode) => <span key={barcode} className="chip mono">{barcode}</span>)}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="conclusion-cell">
                        <ConclusionBadge conclusion={verification.conclusion} />
                        {verification.conclusionNote ? <div className="cell-sub">{verification.conclusionNote}</div> : null}
                        {permissions.canConclude && !verification.promoted ? (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConcluding(verification)}>
                            {verification.conclusion === "PENDING" ? "录入结论" : "修改结论"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="mini-meta">
                      {verification.handledByName ? <div>处理：{verification.handledByName}</div> : null}
                      {verification.handledAt ? <div className="mono">{formatDateTime(verification.handledAt, { seconds: true })}</div> : null}
                      {verification.concludedByName ? <div>结论：{verification.concludedByName}</div> : null}
                      {verification.concludedAt ? <div className="mono">{formatDateTime(verification.concludedAt, { seconds: true })}</div> : null}
                    </td>
                    <td>
                      {verification.promoted ? (
                        <span className="badge badge-green">已转正</span>
                      ) : canPromoteRow ? (
                        <label className="promote-check">
                          <input
                            type="checkbox"
                            className="issue-check"
                            checked={promotedPick.has(verification.id)}
                            onChange={() => togglePromote(verification.id)}
                            aria-label={`选择转正 ${verification.packageCode}`}
                          />
                          待转正
                        </label>
                      ) : (
                        <span className="hint">{verification.conclusion === "PASS" ? "—" : "需验证通过"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title"><Barcode size={14} style={{ verticalAlign: "-2px" }} /> 验证条码台账</h2>
            <div className="section-sub">按条码查看所属软件包、电子流程与验证结论，便于用条码跟踪是否验证通过。</div>
          </div>
          <div className="header-actions">
            <input
              className="input"
              style={{ maxWidth: 240 }}
              value={barcodeSearch}
              onChange={(event) => setBarcodeSearch(event.target.value)}
              placeholder="搜索条码 / 软件包"
              aria-label="搜索验证条码"
            />
            <span className="badge badge-outline">{ledgerEntries.length} 条条码</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table packages-barcode-table">
            <thead>
              <tr>
                <th>验证条码</th>
                <th>软件包</th>
                <th>责任组</th>
                <th>验证版本</th>
                <th>电子流程</th>
                <th>验证结论</th>
                <th>结论时间</th>
                <th>转正</th>
              </tr>
            </thead>
            <tbody>
              {ledgerEntries.length === 0 ? (
                <tr><td colSpan={8}><EmptyHint title="暂无验证条码" description="软件经理处理转验证申请时需要为每个软件包填写验证条码。" /></td></tr>
              ) : ledgerEntries.map((entry) => (
                <tr key={`${entry.verificationId}-${entry.barcode}`}>
                  <td className="main-cell mono">{entry.barcode}</td>
                  <td>
                    <div className="mono">{entry.packageCode}</div>
                    {entry.packageName && entry.packageName !== entry.packageCode ? <div className="cell-sub">{entry.packageName}</div> : null}
                  </td>
                  <td>{entry.groupName ? <span className="chip">{entry.groupName}</span> : <span className="hint">未分配</span>}</td>
                  <td><VersionText value={entry.version} /></td>
                  <td>{entry.processUrl ? <a className="link" href={entry.processUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> 打开</a> : <span className="hint">—</span>}</td>
                  <td><ConclusionBadge conclusion={entry.conclusion} /></td>
                  <td className="mini-meta mono">{formatDateTime(entry.concludedAt, { seconds: true })}</td>
                  <td>{entry.promoted ? <span className="badge badge-green">已转正</span> : <span className="hint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            toast.success("转验证申请已提交，等待软件经理处理");
            await onChanged();
          }}
        />
      ) : null}

      {handlingRequest ? (
        <VerificationModal
          projectId={projectId}
          request={handlingRequest}
          onClose={() => setHandlingRequest(null)}
          onSaved={async () => {
            setHandlingRequest(null);
            toast.success(`${handlingRequest.packageCode} 已进入正式服务器验证`);
            await onChanged();
          }}
        />
      ) : null}

      {editingVerification ? (
        <VerificationModal
          projectId={projectId}
          verification={editingVerification}
          onClose={() => setEditingVerification(null)}
          onSaved={async () => {
            setEditingVerification(null);
            toast.success("转验证信息已更新");
            await onChanged();
          }}
        />
      ) : null}

      {concluding ? (
        <ConclusionModal
          kind="VERIFY"
          item={{
            id: concluding.id,
            packageCode: concluding.packageCode,
            version: concluding.version,
            officialVersion: concluding.officialVersion,
            conclusion: concluding.conclusion,
            conclusionNote: concluding.conclusionNote,
          }}
          submit={async (conclusion, note) => {
            await apiFetch(`/api/projects/${projectId}/package-verifications/${concluding.id}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "conclude", conclusion, note }),
            });
          }}
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

/** 处理 / 编辑逐包转验证：填写电子流程链接与验证条码。 */
function VerificationModal({
  projectId,
  request,
  verification,
  onClose,
  onSaved,
}: {
  projectId: string;
  request?: RequestView;
  verification?: VerificationView;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [processUrl, setProcessUrl] = useState(verification?.processUrl || "");
  const [barcodes, setBarcodes] = useState((verification?.barcodes || []).join(","));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const packageCode = request?.packageCode || verification?.packageCode || "";
  const version = request?.version || verification?.version || "";

  function parseBarcodes(value: string): string[] {
    return [...new Set(value.split(/[\s,，;；]+/).map((entry) => entry.trim()).filter(Boolean))];
  }

  async function submit() {
    setError("");
    const codes = parseBarcodes(barcodes);
    if (!processUrl.trim()) {
      setError("请填写电子流程链接");
      return;
    }
    if (codes.length === 0) {
      setError("请填写至少一个验证条码");
      return;
    }
    setBusy(true);
    try {
      if (request) {
        await apiFetch(`/api/projects/${projectId}/package-verifications`, {
          method: "POST",
          body: JSON.stringify({ requestId: request.id, processUrl: processUrl.trim(), barcodes: codes }),
        });
      } else if (verification) {
        await apiFetch(`/api/projects/${projectId}/package-verifications/${verification.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "update", processUrl: processUrl.trim(), barcodes: codes }),
        });
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
      title={request ? `处理转验证 · ${packageCode}` : `编辑转验证 · ${packageCode}`}
      description={`版本 ${version || "—"}${request ? " · 处理后将进入正式服务器验证" : ""}`}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !processUrl.trim() || parseBarcodes(barcodes).length === 0}>
            {busy ? "保存中…" : request ? "确认进入验证" : "保存"}
          </button>
        </>
      )}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="field">
        <label>电子流程链接（必填）</label>
        <input className="input mono" value={processUrl} onChange={(event) => setProcessUrl(event.target.value)} maxLength={500} placeholder="https://flow.example.com/xxx 或 \\\\share\\流程单号" />
        <div className="field-hint">用于跟踪该软件包转验证 / 转正的电子流程单据，转正时会一并保留。</div>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>验证条码（必填，多个用逗号分隔）</label>
        <input className="input mono" value={barcodes} onChange={(event) => setBarcodes(event.target.value)} placeholder="XH-CPU-2601001,XH-MIX-2601003" aria-label="验证条码" />
        <div className="field-hint">绑定用于正式服务器验证的条码，可在「验证条码台账」中按条码跟踪验证结论。</div>
      </div>
      {request?.changeSummary ? (
        <div className="callout-strip" style={{ marginTop: 12 }}>
          <span><b>申请说明：</b>{request.changeSummary}</span>
        </div>
      ) : null}
    </Modal>
  );
}

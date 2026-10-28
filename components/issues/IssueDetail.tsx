"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CircleDot,
  ClipboardList,
  History,
  Info,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { BarcodeDetail, ProjectStatus } from "@/lib/issues";
import type { GroupDirectoryEntry } from "@/components/issues/types";
import { StatusModal } from "@/components/issues/StatusModal";
import { TransferModal } from "@/components/issues/TransferModal";
import { Modal } from "@/components/Modal";
import { RichTextEditor } from "@/components/RichTextEditor";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface IssueDetailProps {
  projectId: string;
  barcodeId: string;
  initialLabel: string;
  currentUser: { id: string; name: string; employeeNo: string };
  groups: GroupDirectoryEntry[];
  statuses: ProjectStatus[];
  refreshVersion: number;
  onCloseTab: () => void;
  onChanged: () => void;
  onDeleted: (barcodeId: string) => void;
}

type ModalState =
  | { kind: "status-barcode" }
  | { kind: "transfer-barcode" }
  | { kind: "status-issue"; issueId: string; label: string }
  | { kind: "transfer-issue"; issueId: string; label: string }
  | { kind: "tracking" }
  | { kind: "add-item" }
  | { kind: "edit-item"; issueId: string; value: string }
  | { kind: "delete" }
  | null;

function intersection<T>(arrays: T[][]): T[] {
  if (arrays.length === 0) return [];
  return arrays.reduce((acc, current) => acc.filter((item) => current.includes(item)));
}

export function IssueDetail({
  projectId,
  barcodeId,
  initialLabel,
  currentUser,
  groups,
  statuses,
  refreshVersion,
  onCloseTab,
  onChanged,
  onDeleted,
}: IssueDetailProps) {
  const toast = useToast();
  const [barcode, setBarcode] = useState<BarcodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [addItemValue, setAddItemValue] = useState("");
  const [itemPending, setItemPending] = useState(false);
  const [trackingText, setTrackingText] = useState("");
  const [trackingPending, setTrackingPending] = useState(false);
  const [editItemValue, setEditItemValue] = useState("");
  const [deletePending, setDeletePending] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const result = await apiFetch<{ barcode: BarcodeDetail }>(`/api/projects/${projectId}/issues/${barcodeId}`);
      setBarcode(result.barcode);
      setTrackingText(result.barcode.trackingGroups.join("\n"));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, barcodeId]);

  useEffect(() => { void load(); }, [load, refreshVersion]);

  const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  if (loading && !barcode) {
    return <div className="loading"><span className="spinner" /> 正在加载条码详情…</div>;
  }
  if (loadError || !barcode) {
    return (
      <div className="detail-content">
        <div className="alert alert-error">{loadError || "条码不存在"}</div>
        <div className="row"><button type="button" className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={14} /> 重试</button><button type="button" className="btn btn-ghost" onClick={onCloseTab}>关闭标签页</button></div>
      </div>
    );
  }

  const barcodeGroupIds = [...new Set(barcode.issues.flatMap((issue) => issue.groups.map((group) => group.groupId)))];
  const commonGroupIds = intersection(barcode.issues.map((issue) => issue.groups.map((group) => group.groupId)));
  const commonIntraIds = barcode.issues.length > 0
    ? intersection(barcode.issues.map((issue) => issue.permissions.canIntraTransferGroupIds)).filter((id) => commonGroupIds.includes(id))
    : [];
  const canAddItem = barcode.permissions.canAddIssue;
  const canWholeStatus = barcode.permissions.canUpdateAllStatuses;
  const canWholeTransfer = barcode.permissions.canTransferAll;

  async function submitAddItem() {
    if (!addItemValue.trim()) {
      toast.error("请填写报错测试项");
      return;
    }
    setItemPending(true);
    try {
      await apiFetch(`/api/projects/${projectId}/issues/${barcodeId}/items`, {
        method: "POST",
        body: JSON.stringify({ errorItem: addItemValue }),
      });
      toast.success("报错项已追加，并按条码当前责任配置继承处理人");
      setModal(null);
      setAddItemValue("");
      await load(true);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setItemPending(false);
    }
  }

  async function saveTracking() {
    setTrackingPending(true);
    try {
      const groupsList = trackingText.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
      await apiFetch(`/api/projects/${projectId}/issues/${barcodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ trackingGroups: groupsList }),
      });
      toast.success("问题跟踪群号已更新");
      setModal(null);
      await load(true);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTrackingPending(false);
    }
  }

  async function saveErrorItem() {
    if (!modal || modal.kind !== "edit-item") return;
    if (!editItemValue.trim()) {
      toast.error("报错测试项不能为空");
      return;
    }
    setItemPending(true);
    try {
      await apiFetch(`/api/projects/${projectId}/issues/items/${modal.issueId}`, {
        method: "PATCH",
        body: JSON.stringify({ errorItem: editItemValue }),
      });
      toast.success("报错测试项已更新");
      setModal(null);
      await load(true);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setItemPending(false);
    }
  }

  async function confirmDelete() {
    setDeletePending(true);
    try {
      const result = await apiFetch<{ deleted: { id: string; barcode: string }[]; reviewRequired: { id: string; barcode: string }[]; requestId: string | null }>(
        `/api/projects/${projectId}/issues/batch-delete`,
        { method: "POST", body: JSON.stringify({ barcodeIds: [barcodeId] }) },
      );
      if (result.deleted.length > 0) {
        toast.success("条码已删除");
        setModal(null);
        onDeleted(barcodeId);
      } else if (result.reviewRequired.length > 0) {
        toast.success("该条码已有定位原因或责任人转移记录，删除申请已提交项目 PM 审批；审批通过前不会删除");
        setModal(null);
        await load(true);
        onChanged();
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletePending(false);
    }
  }

  function afterAction(message: string) {
    toast.success(message);
    setModal(null);
    void load(true);
    onChanged();
  }

  return (
    <div className="detail-content">
      <div className="detail-headline">
        <div style={{ minWidth: 0 }}>
          <div className="detail-barcode">{barcode.barcode}</div>
          <div className="detail-subline">
            <span className="mono">{barcode.locationNo}</span>
            <span>·</span>
            <span>{barcode.priorityLabel}优先级</span>
            <span>·</span>
            <span>{barcode.issues.length} 个问题项</span>
            {barcode.category ? <span className="badge" style={{ background: `${barcode.category.color}18`, color: barcode.category.color }}>{barcode.category.name}</span> : null}
          </div>
        </div>
        <div className="issue-actions">
          <button type="button" className="icon-btn" title="刷新" onClick={() => void load()}><RefreshCw size={14} /></button>
          <button type="button" className="icon-btn danger" title="删除条码" onClick={() => setModal({ kind: "delete" })}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="row">
        {canWholeStatus ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ kind: "status-barcode" })}><CircleDot size={13} /> 更新全部状态</button> : null}
        {canWholeTransfer ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal({ kind: "transfer-barcode" })}><ArrowRightLeft size={13} /> 转移整码责任</button> : null}
        {canAddItem ? <button type="button" className="btn btn-soft btn-sm" onClick={() => { setAddItemValue(""); setModal({ kind: "add-item" }); }}><Plus size={13} /> 追加报错项</button> : null}
      </div>

      <div className="detail-section">
        <div className="detail-section-title">基础信息</div>
        <div className="kv-grid">
          <div className="kv"><div className="k">库位号</div><div className="v mono">{barcode.locationNo}</div></div>
          <div className="kv"><div className="k">云主机 IP</div><div className="v mono">{barcode.hostIp || "未维护"}</div></div>
          <div className="kv"><div className="k">设备在云主机中的 IP</div><div className="v mono">{barcode.deviceIp || "未识别"}</div></div>
          <div className="kv"><div className="k">录入人 / 时间</div><div className="v">{barcode.creator} · {formatDateTime(barcode.createdAt)}</div></div>
          {barcode.hostAccount ? <div className="kv"><div className="k">云主机账号</div><div className="v mono">{barcode.hostAccount}</div></div> : null}
          <div className="kv full"><div className="k">录入备注</div><div className="v" style={{ whiteSpace: "pre-wrap" }}>{barcode.remark || "—"}</div></div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <span><MessageSquareText size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />问题跟踪群号</span>
          <button type="button" className="link-btn" onClick={() => setModal({ kind: "tracking" })}><Pencil size={12} /> 编辑</button>
        </div>
        {barcode.trackingGroups.length > 0 ? (
          <div className="tracking-list">{barcode.trackingGroups.map((group) => <span key={group} className="chip teal">{group}</span>)}</div>
        ) : <div className="empty-mini">暂未填写跟踪群号，点击编辑可添加多个群号。</div>}
      </div>

      <div className="detail-section">
        <div className="detail-section-title">
          <span>问题与责任追踪</span>
          <span className="hint">同一内容只通知配置责任人</span>
        </div>
        {barcode.issues.map((issue, index) => {
          const groupNames = issue.groups.map((group) => group.groupName).join("、");
          return (
            <div className="issue-item-card" key={issue.id}>
              <div className="issue-item-head">
                <div style={{ minWidth: 0 }}>
                  <div className="issue-item-index">问题项 #{index + 1}</div>
                  <div className="issue-item-title" style={{ marginTop: 3 }}>{issue.errorItem || "首次录入问题（未填写报错项）"}</div>
                </div>
                <span className="status-badge" style={{ color: issue.status.color, background: `${issue.status.color}15`, borderColor: `${issue.status.color}30` }}>
                  <span className="status-dot" style={{ background: issue.status.color }} />{issue.status.name}
                </span>
              </div>
              <div className="issue-item-body">
                <div className="issue-groups-list">
                  {issue.groups.length === 0 ? <div className="empty-mini">无参与责任组</div> : issue.groups.map((group) => (
                    <div className="issue-group-pill" key={group.groupId}>
                      <span className="group-name">{group.groupName}</span>
                      <span className="handlers">
                        {group.handlers.length === 0 ? <span className="hint">无当前处理人</span> : group.handlers.map((handler) => (
                          <span key={handler.id} className="resolved-chip" style={{ padding: "1px 6px", fontSize: 10 }}>
                            {handler.name}{handler.isPrimary ? <small style={{ color: "var(--primary)" }}>主</small> : <small>协办</small>}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="issue-actions">
                  {issue.permissions.canUpdateStatus ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "status-issue", issueId: issue.id, label: `条码 ${barcode.barcode} · 问题项 #${index + 1}` })}><CircleDot size={12} /> 更新状态</button> : null}
                  {issue.permissions.canTransfer ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "transfer-issue", issueId: issue.id, label: `条码 ${barcode.barcode} · 问题项 #${index + 1}` })}><ArrowRightLeft size={12} /> 转移责任</button> : null}
                  {issue.permissions.canEditContent ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditItemValue(issue.errorItem); setModal({ kind: "edit-item", issueId: issue.id, value: issue.errorItem }); }}><Pencil size={12} /> 编辑报错项</button> : null}
                </div>

                {issue.statusHistory.length > 0 ? (
                  <div>
                    <div className="mini-meta" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><History size={11} /> 状态历史</div>
                    <div className="history-list">
                      {issue.statusHistory.map((item) => (
                        <div className="history-item" key={item.id}>
                          <div className="history-top">
                            <span className="history-type">{item.oldStatus} → {item.newStatus}</span>
                            <span className="history-time">{formatDateTime(item.createdAt)} · {item.operator}</span>
                          </div>
                          {item.reasonHtml ? <div className="history-reason"><div className="rich-content" dangerouslySetInnerHTML={{ __html: item.reasonHtml }} /></div> : <div className="history-detail">未填写原因</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <div className="mini-meta" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><ClipboardList size={11} /> 责任人转移路径</div>
                  <div className="history-list">
                    {issue.assignmentHistory.length === 0 ? <div className="empty-mini">暂无责任变更历史</div> : issue.assignmentHistory.map((item) => (
                      <div className={`history-item ${item.changeType !== "ENTRY" ? "strong" : ""}`} key={item.id}>
                        <div className="history-top">
                          <span className="badge badge-outline">{item.changeTypeLabel}</span>
                          <span className="history-time">{formatDateTime(item.createdAt)} · {item.operator || "系统"}</span>
                        </div>
                        <div className="history-detail">
                          <div><strong>责任组：</strong>{item.fromGroups.length ? item.fromGroups.join("、") : "—"} → {item.toGroups.join("、") || "—"}{item.retainedGroups.length ? `（保留：${item.retainedGroups.join("、")}）` : ""}</div>
                          <div><strong>处理人：</strong>{item.fromHandlers.length ? item.fromHandlers.join("、") : "—"} → {item.toHandlers.join("、") || "—"}</div>
                        </div>
                        {item.reasonHtml ? <div className="history-reason"><div className="rich-content" dangerouslySetInnerHTML={{ __html: item.reasonHtml }} /></div> : null}
                        {item.anomalies.map((anomaly) => <div className="history-anomaly" key={anomaly}><TriangleAlert size={10} style={{ verticalAlign: "-1px" }} /> {anomaly}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="detail-section">
        <div className="row" style={{ gap: 6, color: "var(--muted-2)", fontSize: 10.5 }}>
          <Info size={12} /> 责任路由由录入、组内转交、跨组转接、班次交接和维护中的兜底分配决定。
        </div>
      </div>

      {modal?.kind === "status-barcode" ? (
        <StatusModal
          projectId={projectId}
          selection={{ kind: "barcode", barcodeId, label: `条码 ${barcode.barcode}（全部 ${barcode.issues.length} 个问题项）` }}
          statuses={statuses}
          onClose={() => setModal(null)}
          onUpdated={afterAction}
        />
      ) : null}
      {modal?.kind === "status-issue" ? (
        <StatusModal
          projectId={projectId}
          selection={{ kind: "issue", issueId: modal.issueId, label: modal.label }}
          statuses={statuses}
          onClose={() => setModal(null)}
          onUpdated={afterAction}
        />
      ) : null}
      {modal?.kind === "transfer-barcode" ? (
        <TransferModal
          projectId={projectId}
          selection={{ kind: "barcode", barcodeId, label: `条码 ${barcode.barcode}（全部 ${barcode.issues.length} 个问题项）` }}
          currentGroupIds={barcodeGroupIds}
          intraGroupIds={commonIntraIds}
          groups={groups}
          onClose={() => setModal(null)}
          onTransferred={afterAction}
        />
      ) : null}
      {modal?.kind === "transfer-issue" ? (() => {
        const issue = barcode.issues.find((item) => item.id === modal.issueId);
        if (!issue) return null;
        return (
          <TransferModal
            projectId={projectId}
            selection={{ kind: "issue", issueId: issue.id, barcodeId, label: modal.label }}
            currentGroupIds={issue.groups.map((group) => group.groupId)}
            intraGroupIds={issue.permissions.canIntraTransferGroupIds}
            groups={groups}
            onClose={() => setModal(null)}
            onTransferred={afterAction}
          />
        );
      })() : null}

      {modal?.kind === "tracking" ? (
        <Modal
          title="编辑问题跟踪群号"
          description="可填写多个群号，每行一个或用逗号分隔；项目参与人员均可编辑。"
          onClose={() => setModal(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)} disabled={trackingPending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={() => void saveTracking()} disabled={trackingPending}>{trackingPending ? "保存中…" : "保存群号"}</button>
          </>}
        >
          <div className="field">
            <label>跟踪群号</label>
            <textarea className="textarea" value={trackingText} onChange={(event) => setTrackingText(event.target.value)} placeholder="例如：定位协作群 128900123\nCPU 专项讨论群 230011" rows={5} />
            <div className="field-hint">最多 20 个，每个不超过 100 个字符。</div>
          </div>
        </Modal>
      ) : null}

      {modal?.kind === "add-item" ? (
        <Modal
          title="追加报错项"
          description="新增的报错项会继承该条码最近的参与责任组和当前处理人，后续可独立转交或更新状态。"
          onClose={() => setModal(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)} disabled={itemPending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={() => void submitAddItem()} disabled={itemPending}>{itemPending ? "追加中…" : "追加报错项"}</button>
          </>}
        >
          <div className="field">
            <label>报错测试项 <span className="required">*</span></label>
            <input className="input" value={addItemValue} onChange={(event) => setAddItemValue(event.target.value)} placeholder="例如：CPU 满载温度超过阈值" maxLength={500} autoFocus />
          </div>
        </Modal>
      ) : null}

      {modal?.kind === "edit-item" ? (
        <Modal
          title="编辑报错测试项"
          description="报错项用于统计高频错误，修改后会立即生效。"
          onClose={() => setModal(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)} disabled={itemPending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={() => void saveErrorItem()} disabled={itemPending}>{itemPending ? "保存中…" : "保存"}</button>
          </>}
        >
          <div className="field">
            <label>报错测试项 <span className="required">*</span></label>
            <input className="input" value={editItemValue} onChange={(event) => setEditItemValue(event.target.value)} maxLength={500} autoFocus />
          </div>
        </Modal>
      ) : null}

      {modal?.kind === "delete" ? (
        <Modal
          title="删除条码"
          description={`即将申请删除条码 ${barcode.barcode} 及其全部问题项。`}
          size="sm"
          onClose={() => (deletePending ? null : setModal(null))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)} disabled={deletePending}>取消</button>
            <button type="button" className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deletePending}>{deletePending ? "处理中…" : "确认删除"}</button>
          </>}
        >
          <div className="alert alert-warning">
            <ShieldAlert size={15} />
            如果该条码写过定位原因或转移过责任人，删除将提交项目 PM 审核；审批通过前条码不会删除，且不设恢复环节。
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

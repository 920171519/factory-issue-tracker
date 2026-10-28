"use client";

import { useState } from "react";
import { CircleAlert, CircleCheckBig, LoaderCircle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { RichTextEditor } from "@/components/RichTextEditor";
import { apiFetch, errorMessage } from "@/lib/client-api";
import type { ProjectStatus } from "@/lib/issues";
import type { StatusSelection } from "@/components/issues/types";

interface StatusModalProps {
  projectId: string;
  selection: StatusSelection;
  statuses: ProjectStatus[];
  defaultStatusId?: string;
  onClose: () => void;
  onUpdated: (message: string) => void;
}

interface StatusResult {
  updatedIssues: number;
  skippedIssues: number;
  barcodeIds: string[];
  notifiedRecipients: number;
}

export function StatusModal({ projectId, selection, statuses, defaultStatusId, onClose, onUpdated }: StatusModalProps) {
  const [statusId, setStatusId] = useState(defaultStatusId || statuses[0]?.id || "");
  const [reasonHtml, setReasonHtml] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selectedStatus = statuses.find((status) => status.id === statusId);
  const requiresReason = selectedStatus?.requires_reason === 1;

  async function submit() {
    setError("");
    if (!statusId) {
      setError("请选择新状态");
      return;
    }
    const plainReason = reasonHtml.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
    if (requiresReason && !plainReason) {
      setError(`状态「${selectedStatus?.name}」必须填写定位原因`);
      return;
    }
    setPending(true);
    try {
      let endpoint = "";
      let body: Record<string, unknown> = { statusId, reasonHtml, confirmed: true };
      if (selection.kind === "issue") endpoint = `/api/projects/${projectId}/issues/items/${selection.issueId}/status`;
      else if (selection.kind === "barcode") endpoint = `/api/projects/${projectId}/issues/${selection.barcodeId}/status`;
      else {
        endpoint = `/api/projects/${projectId}/issues/batch-status`;
        body = { ...body, barcodeIds: selection.barcodeIds };
      }
      const result = await apiFetch<StatusResult>(endpoint, { method: "POST", body: JSON.stringify(body) });
      onUpdated(
        `状态已更新：${result.updatedIssues} 个问题${result.skippedIssues > 0 ? `，${result.skippedIssues} 个已是目标状态已跳过` : ""}；通知 ${result.notifiedRecipients} 人`,
      );
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="更新问题状态"
      description={`操作对象：${selection.label}。状态只表示业务进展，不改变参与责任组或责任人。`}
      onClose={() => (pending ? null : onClose())}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={pending || !statusId}>
            {pending ? <LoaderCircle size={14} className="spin" /> : <CircleCheckBig size={14} />}
            {pending ? "更新中…" : "确认更新状态"}
          </button>
        </>
      }
    >
      <div className="field">
        <label>新状态 <span className="required">*</span></label>
        <select className="select" value={statusId} onChange={(event) => setStatusId(event.target.value)}>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>{status.name}{status.requires_reason ? " · 需填原因" : ""}</option>
          ))}
        </select>
        <div className="field-hint">
          {selectedStatus ? (
            <>
              {selectedStatus.counts_pending === 1 ? "该状态计入当前处理人的待处理问题数。" : "该状态不计入当前处理人的待处理问题数。"}
              {selectedStatus.is_identified === 1 ? " 已标记为已定位。" : ""}
            </>
          ) : null}
        </div>
      </div>
      {selectedStatus && selectedStatus.requires_reason === 1 ? (
        <div className="alert alert-warning" style={{ marginTop: 12 }}>
          <CircleAlert size={14} /> 更新为「{selectedStatus.name}」时必须填写定位原因，并会记录到状态历史。
        </div>
      ) : null}
      <div className="field" style={{ marginTop: 13 }}>
        <label>定位原因 / 更新说明 {requiresReason ? <span className="required">*</span> : <span className="hint">（可选）</span>}</label>
        <RichTextEditor value={reasonHtml} onChange={setReasonHtml} placeholder="说明当前定位结论或状态变更原因，支持粘贴图片…" minHeight={110} />
      </div>
      <div className="alert alert-info" style={{ marginTop: 12 }}>
        <CircleAlert size={14} />
        确认后将立即更新并通知所有参与责任组当前处理人。批量更新会按责任人合并发送一次通知。
      </div>
      {error ? <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
    </Modal>
  );
}

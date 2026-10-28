"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Clock3, ShieldCheck, ShieldX, UserRound, X } from "lucide-react";
import type { DeletionRequestSummary } from "@/lib/deletion";
import { Modal } from "@/components/Modal";
import { RichTextEditor } from "@/components/RichTextEditor";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface ApprovalsClientProps {
  projectId: string;
  requests: DeletionRequestSummary[];
  isPm: boolean;
}

type ActionState = { request: DeletionRequestSummary; action: "APPROVE" | "REJECT" } | null;

export function ApprovalsClient({ projectId, requests, isPm }: ApprovalsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [actionState, setActionState] = useState<ActionState>(null);
  const [reasonHtml, setReasonHtml] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRequests = requests.filter((request) => request.status === "PENDING");
  const historyRequests = requests.filter((request) => request.status !== "PENDING");

  async function submitAction() {
    if (!actionState) return;
    setError("");
    setPending(true);
    try {
      const result = await apiFetch<{ status: string; deletedCount: number }>(
        `/api/projects/${projectId}/approvals/${actionState.request.id}`,
        {
          method: "POST",
          body: JSON.stringify({ action: actionState.action, reasonHtml }),
        },
      );
      setActionState(null);
      setReasonHtml("");
      toast.success(
        actionState.action === "APPROVE"
          ? `审批已通过，实际删除 ${result.deletedCount} 个条码`
          : "已驳回删除申请，并通知发起人",
      );
      router.refresh();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  function RequestCard({ request }: { request: DeletionRequestSummary }) {
    const statusMap = {
      PENDING: { label: "待审批", cls: "badge-amber" },
      APPROVED: { label: "已通过", cls: "badge-green" },
      REJECTED: { label: "已驳回", cls: "badge-red" },
    } as const;
    const status = statusMap[request.status];
    return (
      <div className="card" style={{ borderColor: request.status === "PENDING" ? "#f0dfbf" : "var(--border)" }}>
        <div className="card-header">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="section-title" style={{ fontSize: 14 }}>删除申请 · {request.barcodes.length} 个条码</span>
              <span className={`badge ${status.cls}`}>{status.label}</span>
            </div>
            <div className="section-sub row" style={{ gap: 10, marginTop: 5 }}>
              <span><UserRound size={11} style={{ verticalAlign: "-1px" }} /> 发起人：{request.requester}</span>
              <span><Clock3 size={11} style={{ verticalAlign: "-1px" }} /> {formatDateTime(request.createdAt)}</span>
            </div>
          </div>
          {request.status === "PENDING" && isPm ? (
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-danger-soft btn-sm" onClick={() => { setActionState({ request, action: "REJECT" }); setReasonHtml(""); }}>
                <ShieldX size={13} /> 驳回
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setActionState({ request, action: "APPROVE" }); setReasonHtml(""); }}>
                <CheckCircle2 size={13} /> 通过
              </button>
            </div>
          ) : null}
        </div>
        <div className="card-body" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div className="field-label" style={{ marginBottom: 7 }}>包含条码</div>
          <div className="chip-list">
            {request.barcodes.map((barcode) => (
              <span key={`${request.id}-${barcode.barcode}`} className="chip">
                <span className="mono">{barcode.barcode}</span>
                {barcode.locationNo ? <span className="mini-meta">{barcode.locationNo}</span> : null}
              </span>
            ))}
          </div>
          {request.status !== "PENDING" ? (
            <div className="row" style={{ marginTop: 11, gap: 8, alignItems: "flex-start" }}>
              <span className={`badge ${request.status === "APPROVED" ? "badge-green" : "badge-red"}`}>{request.status === "APPROVED" ? "通过" : "驳回"}</span>
              <span className="small muted">
                {request.reviewer || "—"} · {formatDateTime(request.reviewedAt)}
                {request.reviewReasonHtml ? <span className="rich-content" style={{ display: "block", marginTop: 4 }} dangerouslySetInnerHTML={{ __html: request.reviewReasonHtml }} /> : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Approvals</div>
          <h1 className="page-title">删除审批</h1>
          <p className="page-sub">只有写过定位原因或转移过责任人的条码在删除时需要项目 PM 审核。审批通知仅发送给项目 PM，项目主管可查看但不能自动获得审批通知。</p>
        </div>
        <div className="header-actions"><span className="badge badge-amber">待审批 {pendingRequests.length}</span></div>
      </div>

      {!isPm ? <div className="callout-strip"><ShieldCheck size={15} /> 当前为只读审批视图；仅项目 PM 可执行通过/驳回操作。</div> : null}

      <div className="section-head" style={{ marginBottom: 0 }}>
        <div><h2 className="section-title">待审批</h2><div className="section-sub">审核通过时才真正删除条码；未通过前条码保持可访问。</div></div>
      </div>
      {pendingRequests.length === 0 ? (
        <div className="card empty-state" style={{ padding: "34px 20px" }}><div className="empty-icon"><ShieldCheck size={20} /></div><h3>没有待审批申请</h3><p>需要审核的删除操作会出现在这里。</p></div>
      ) : (
        <div className="stack-sm" style={{ gap: 12 }}>{pendingRequests.map((request) => <RequestCard key={request.id} request={request} />)}</div>
      )}

      <div className="section-head" style={{ marginBottom: 0, marginTop: 8 }}>
        <div><h2 className="section-title">历史审批</h2><div className="section-sub">审核记录保留条码快照，不提供条码恢复功能。</div></div>
      </div>
      {historyRequests.length === 0 ? (
        <div className="card empty-state" style={{ padding: "30px 20px" }}><h3>暂无历史审批</h3></div>
      ) : (
        <div className="stack-sm" style={{ gap: 12 }}>{historyRequests.map((request) => <RequestCard key={request.id} request={request} />)}</div>
      )}

      {actionState ? (
        <Modal
          title={actionState.action === "APPROVE" ? "通过删除审批" : "驳回删除审批"}
          description={`申请包含 ${actionState.request.barcodes.length} 个条码：${actionState.request.barcodes.map((barcode) => barcode.barcode).join("、")}`}
          onClose={() => (pending ? null : setActionState(null))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setActionState(null)} disabled={pending}>取消</button>
            <button type="button" className={`btn ${actionState.action === "APPROVE" ? "btn-danger" : "btn-primary"}`} onClick={() => void submitAction()} disabled={pending}>
              {pending ? "处理中…" : actionState.action === "APPROVE" ? "确认通过并删除" : "确认驳回"}
            </button>
          </>}
        >
          {actionState.action === "APPROVE" ? (
            <div className="alert alert-warning">
              <ShieldX size={15} /> 通过后系统会立即实际删除这些条码及其全部错误项和问题信息，无法恢复。责任人转移历史也不再可查询。
            </div>
          ) : (
            <div className="field">
              <label>驳回说明</label>
              <RichTextEditor value={reasonHtml} onChange={setReasonHtml} placeholder="说明驳回原因，发起人会收到通知…" minHeight={100} />
            </div>
          )}
          {error ? <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
        </Modal>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Info, LoaderCircle, Route, UsersRound } from "lucide-react";
import { Modal } from "@/components/Modal";
import { RichTextEditor } from "@/components/RichTextEditor";
import { apiFetch, errorMessage } from "@/lib/client-api";
import type { GroupDirectoryEntry, TransferSelection } from "@/components/issues/types";

interface TransferModalProps {
  projectId: string;
  selection: TransferSelection;
  currentGroupIds: string[];
  intraGroupIds: string[];
  groups: GroupDirectoryEntry[];
  onClose: () => void;
  onTransferred: (message: string) => void;
}

interface TransferResult {
  transferredIssues: number;
  transferredBarcodes: number;
  notifiedRecipients: number;
}

export function TransferModal({
  projectId,
  selection,
  currentGroupIds,
  intraGroupIds,
  groups,
  onClose,
  onTransferred,
}: TransferModalProps) {
  const enabledGroups = groups.filter((group) => group.enabled);
  const intraCandidates = enabledGroups.filter((group) => intraGroupIds.includes(group.id));
  const targetCandidates = enabledGroups.filter((group) => !currentGroupIds.includes(group.id));
  const initialMode = intraCandidates.length > 0 ? "INTRA" : "CROSS";
  const [mode, setMode] = useState<"INTRA" | "CROSS">(initialMode);
  const [groupId, setGroupId] = useState(intraCandidates[0]?.id || "");
  const [targetUserId, setTargetUserId] = useState("");
  const [targetGroupIds, setTargetGroupIds] = useState<string[]>([]);
  const [retainedGroupIds, setRetainedGroupIds] = useState<string[]>([]);
  const [reasonHtml, setReasonHtml] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const selectedGroup = groups.find((group) => group.id === groupId);
  const memberOptions = selectedGroup?.members || [];

  const currentGroupNames = useMemo(
    () => groups.filter((group) => currentGroupIds.includes(group.id)).map((group) => group.name),
    [groups, currentGroupIds],
  );

  function toggleTarget(id: string) {
    setTargetGroupIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleRetain(id: string) {
    setRetainedGroupIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit() {
    setError("");
    const plainReason = reasonHtml.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
    if (!plainReason) {
      setError("请填写当前定位结论或转移原因，可同时附带图片");
      return;
    }
    if (mode === "INTRA") {
      if (!groupId) {
        setError("请选择要执行组内转交的责任组");
        return;
      }
      if (!targetUserId) {
        setError("请选择本责任组的接收成员");
        return;
      }
    } else {
      if (targetGroupIds.length === 0) {
        setError("请选择一个或多个目标责任组");
        return;
      }
    }
    setPending(true);
    try {
      const body: Record<string, unknown> =
        mode === "INTRA"
          ? { mode, reasonHtml, groupId, targetUserId }
          : { mode, reasonHtml, targetGroupIds, retainedGroupIds };
      let endpoint = "";
      if (selection.kind === "issue") endpoint = `/api/projects/${projectId}/issues/items/${selection.issueId}/transfer`;
      else if (selection.kind === "barcode") endpoint = `/api/projects/${projectId}/issues/${selection.barcodeId}/transfer`;
      else {
        endpoint = `/api/projects/${projectId}/issues/batch-transfer`;
        body.barcodeIds = selection.barcodeIds;
      }
      const result = await apiFetch<TransferResult>(endpoint, { method: "POST", body: JSON.stringify(body) });
      onTransferred(
        mode === "INTRA"
          ? `已完成组内转交，涉及 ${result.transferredIssues} 个问题`
          : `已完成跨组转接，涉及 ${result.transferredIssues} 个问题，通知 ${result.notifiedRecipients} 人`,
      );
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title="转移责任人"
      description={`操作对象：${selection.label}。只能在本组内转交，或转接到其他责任组（不可直接选人）。`}
      size="lg"
      onClose={() => (pending ? null : onClose())}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={pending}>
            {pending ? <LoaderCircle size={14} className="spin" /> : <ArrowRightLeft size={14} />}
            {pending ? "转移中…" : "确认转移"}
          </button>
        </>
      }
    >
      <div className="subtabbar" style={{ marginBottom: 17 }}>
        {intraCandidates.length > 0 ? (
          <button type="button" className={`subtab ${mode === "INTRA" ? "active" : ""}`} onClick={() => setMode("INTRA")}>
            本责任组内转交
          </button>
        ) : null}
        {targetCandidates.length > 0 ? (
          <button type="button" className={`subtab ${mode === "CROSS" ? "active" : ""}`} onClick={() => setMode("CROSS")}>
            跨责任组转接
          </button>
        ) : null}
      </div>

      {mode === "INTRA" ? (
        <div className="stack-sm">
          <div className="callout-strip">
            <UsersRound size={14} /> 组内转交保持参与责任组不变，目标成员将成为该组当前处理人。跨班次时若新排班仍包含该成员则保持。
          </div>
          <div className="form-grid">
            <div className="field">
              <label>责任组</label>
              <select className="select" value={groupId} onChange={(event) => { setGroupId(event.target.value); setTargetUserId(""); }}>
                <option value="">请选择</option>
                {intraCandidates.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>接收成员</label>
              <select className="select" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} disabled={!groupId}>
                <option value="">请选择本组成员</option>
                {memberOptions.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}（{member.employeeNo}）{member.isLeader ? " · 负责人" : ""}</option>
                ))}
              </select>
            </div>
          </div>
          {selectedGroup && selectedGroup.members.length === 0 ? <div className="alert alert-warning">该责任组暂无成员，请先维护组内成员。</div> : null}
        </div>
      ) : (
        <div className="stack-sm">
          <div className="callout-strip">
            <Route size={14} /> 跨组转接只选择目标责任组，系统按目标组当前排班自动解析处理人。多个目标组共同参与，不设主责组。
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 7 }}>目标责任组 <span className="required">*</span></div>
            {targetCandidates.length === 0 ? <div className="alert alert-warning">没有可转接的其他启用责任组。</div> : (
              <div className="choice-grid">
                {targetCandidates.map((group) => (
                  <label className={`choice ${targetGroupIds.includes(group.id) ? "selected" : ""}`} key={group.id}>
                    <input type="checkbox" checked={targetGroupIds.includes(group.id)} onChange={() => toggleTarget(group.id)} />
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.members.filter((member) => member.isLeader).map((member) => member.name).join("、") || "暂无负责人"}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {currentGroupIds.length > 0 ? (
            <div>
              <div className="field-label" style={{ marginBottom: 7 }}>保留原参与责任组</div>
              <div className="choice-grid">
                {groups.filter((group) => currentGroupIds.includes(group.id)).map((group) => (
                  <label className={`choice ${retainedGroupIds.includes(group.id) ? "selected" : ""}`} key={group.id}>
                    <input type="checkbox" checked={retainedGroupIds.includes(group.id)} onChange={() => toggleRetain(group.id)} />
                    <span><strong>{group.name}</strong><small>默认转出，勾选后继续参与</small></span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="hint">当前参与责任组：{currentGroupNames.join("、") || "—"}。未勾选保留的组将从该问题移出。</div>
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>当前定位结论 / 转移原因 <span className="required">*</span></label>
        <RichTextEditor value={reasonHtml} onChange={setReasonHtml} placeholder="写清当前定位结论、为何需要转交/转接，支持粘贴图片…" minHeight={105} />
      </div>
      {error ? <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
      <div className="alert alert-info" style={{ marginTop: 12 }}>
        <Info size={14} />
        {mode === "INTRA"
          ? "组内转交不会改变问题的参与责任组。转移动作和原因将写入责任人变更历史。"
          : "目标组若当前无排班，将兜底到组负责人、默认处理人、兜底处理人及项目 PM，并记录排班缺失提示，不阻塞转接。"}
      </div>
    </Modal>
  );
}
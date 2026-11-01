"use client";

import { useState } from "react";
import type { BatchItemView, PackagesPayload } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { Modal } from "@/components/Modal";

export function RequestModal({
  projectId,
  payload,
  kind,
  sourceItem,
  onClose,
  onCreated,
}: {
  projectId: string;
  payload: PackagesPayload;
  kind: "TEST" | "VERIFY";
  sourceItem?: BatchItemView;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const canPickAny = payload.permissions.canManage || payload.permissions.canPromote;
  const eligiblePackages = payload.packages.filter(
    (pkg) => canPickAny || (pkg.groupId ? payload.permissions.groupIds.includes(pkg.groupId) : false),
  );
  const [packageId, setPackageId] = useState(sourceItem?.packageId || eligiblePackages[0]?.id || "");
  const [version, setVersion] = useState(sourceItem?.version || "");
  const [changeSummary, setChangeSummary] = useState(sourceItem?.changeSummary || "");
  const [packageUrl, setPackageUrl] = useState(sourceItem?.packageUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = payload.packages.find((pkg) => pkg.id === packageId) || null;
  const isVerify = kind === "VERIFY";

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/projects/${projectId}/package-requests`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          packageId,
          version,
          changeSummary,
          packageUrl,
          sourceItemId: sourceItem?.id,
        }),
      });
      await onCreated();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isVerify ? "提交转验证申请" : "提交转测试申请"}
      description={isVerify
        ? "测试通过的软件包可申请转验证版本，由负责人统一组织后进入正式服务器验证。"
        : "填写软件包、修改内容与存放链接；负责人会统一组织成转测试批次。"}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !packageId || !version.trim()}>
            {busy ? "提交中…" : "提交申请"}
          </button>
        </>
      )}
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="form-grid">
        <div className="field">
          <label>软件包</label>
          {isVerify ? (
            <input className="input mono" value={sourceItem?.packageCode || ""} readOnly />
          ) : (
            <select className="select" value={packageId} onChange={(event) => setPackageId(event.target.value)}>
              <option value="">请选择软件包</option>
              {eligiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.code}{pkg.name !== pkg.code ? ` · ${pkg.name}` : ""}</option>
              ))}
            </select>
          )}
          {!isVerify && selected ? (
            <div className="field-hint">
              责任组：{selected.groupName || "未分配"} · 正式版本：{selected.officialVersion || "—"}
            </div>
          ) : null}
          {!isVerify && eligiblePackages.length === 0 ? (
            <div className="field-hint">你所在的责任组下暂无可提交的软件包，请先由 PM 为软件包指定责任组。</div>
          ) : null}
        </div>
        <div className="field">
          <label>版本号</label>
          <input
            className="input mono"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            readOnly={isVerify}
            maxLength={50}
            placeholder="例如 V1.5 / Rev.C1"
          />
          {isVerify && sourceItem ? <div className="field-hint">取自测试通过的转测版本，不可修改</div> : null}
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>修改内容{isVerify ? "（可选）" : ""}</label>
          <textarea className="input" rows={3} value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} maxLength={2000} placeholder="本次修改/修复的内容摘要" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>软件包存放链接{isVerify ? "（可选）" : ""}</label>
          <input className="input mono" value={packageUrl} onChange={(event) => setPackageUrl(event.target.value)} maxLength={500} placeholder="\\\\share\\release\\XH-CPU-2601\\V1.5 或 https://…" />
        </div>
      </div>
    </Modal>
  );
}

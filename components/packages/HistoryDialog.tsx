"use client";

import { useEffect, useState } from "react";
import { ArrowRight, GitBranch, History } from "lucide-react";
import type { HistoryEvent, PackageOverview } from "@/lib/packages";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { Modal } from "@/components/Modal";
import { ConclusionBadge, EmptyHint, StatusBadge, VersionText } from "@/components/packages/shared";
import { formatDateTime } from "@/lib/time";

const EVENT_LABEL: Record<HistoryEvent["type"], string> = {
  REQUEST: "申请",
  BATCH: "批次",
  CONCLUSION: "结论",
  BARCODES: "条码",
  PROMOTE: "转正",
};

const EVENT_TONE: Record<HistoryEvent["type"], string> = {
  REQUEST: "pkg-event-request",
  BATCH: "pkg-event-batch",
  CONCLUSION: "pkg-event-conclusion",
  BARCODES: "pkg-event-barcode",
  PROMOTE: "pkg-event-promote",
};

export function HistoryDialog({
  projectId,
  packageId,
  packageCode,
  onClose,
}: {
  projectId: string;
  packageId: string;
  packageCode: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ package: PackageOverview; events: HistoryEvent[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiFetch<{ package: PackageOverview; events: HistoryEvent[] }>(`/api/projects/${projectId}/packages/${packageId}`);
        if (!cancelled) setData(result);
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError));
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, packageId]);

  const pkg = data?.package;

  return (
    <Modal title={`变更历史 · ${packageCode}`} description="按时间倒序展示转测试、测试结论、转验证、验证条码与转正全过程。" size="lg" onClose={onClose}>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {!data && !error ? <div className="loading"><span className="spinner" /> 正在加载历史…</div> : null}
      {pkg ? (
        <div className="pkg-history-summary">
          <div className="pkg-history-versions">
            <span><span className="hint">正式</span> <VersionText value={pkg.officialVersion} /></span>
            <ArrowRight size={12} />
            <span><span className="hint">验证</span> <VersionText value={pkg.verificationVersion} /></span>
            <ArrowRight size={12} />
            <span><span className="hint">测试</span> <VersionText value={pkg.testVersion} /></span>
            <StatusBadge status={pkg.status} label={pkg.statusLabel} />
          </div>
          <div className="hint">{pkg.groupName || "未分配责任组"} · 负责人 {pkg.ownerName || "—"}</div>
        </div>
      ) : null}
      {data ? (
        data.events.length === 0 ? (
          <EmptyHint title="暂无版本流转记录" description="提交转测试申请并组织批次后，这里会记录全过程。" />
        ) : (
          <ol className="pkg-history-timeline">
            {data.events.map((event) => (
              <li key={event.id} className={`pkg-history-item ${EVENT_TONE[event.type]}`}>
                <span className="pkg-history-dot" aria-hidden />
                <div className="pkg-history-body">
                  <div className="pkg-history-title">
                    <span className="pkg-history-kind">{EVENT_LABEL[event.type]}</span>
                    {event.kind === "TEST" ? <span className="badge badge-neutral">转测试</span> : <span className="badge badge-teal">转验证</span>}
                    <span>{event.title}</span>
                    {event.batchCode ? <span className="mini-meta mono">{event.batchCode}</span> : null}
                    {event.conclusion ? <ConclusionBadge conclusion={event.conclusion} /> : null}
                  </div>
                  <div className="pkg-history-detail">{event.detail}</div>
                  <div className="pkg-history-meta">
                    <History size={11} /> {formatDateTime(event.at, { seconds: true })}
                    {event.operatorName ? <> · {event.operatorName}</> : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
      {data ? (
        <div className="field-hint" style={{ marginTop: 12 }}>
          <GitBranch size={12} style={{ verticalAlign: "-2px" }} /> 历史由批次快照生成，软件包改名或版本变化不会影响已生成的历史记录。
        </div>
      ) : null}
    </Modal>
  );
}

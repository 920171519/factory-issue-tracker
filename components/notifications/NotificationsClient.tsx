"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, CheckCheck, ChevronRight, Inbox, LoaderCircle } from "lucide-react";
import type { NotificationRow } from "@/lib/notifications";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface NotificationsClientProps {
  notifications: NotificationRow[];
  unread: number;
}

export function NotificationsClient({ notifications, unread }: NotificationsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const visible = filter === "unread" ? notifications.filter((notification) => !notification.read_at) : notifications;

  async function markAllRead() {
    setPending(true);
    try {
      await apiFetch("/api/notifications", { method: "PATCH", body: JSON.stringify({ all: true }) });
      toast.success("全部通知已标记为已读");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function markOne(id: string) {
    try {
      await apiFetch("/api/notifications", { method: "PATCH", body: JSON.stringify({ ids: [id] }) });
      router.refresh();
    } catch {
      // Silent: navigation should not be blocked by a read-state update.
    }
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-kicker">Notification Log</div>
          <h1 className="page-title">通知中心</h1>
          <p className="page-sub">通知仅记录发送日志：问题 ID、通知对象、时间、渠道和发送结果；不保存排班或责任矩阵快照。</p>
        </div>
        <div className="header-actions">
          {unread > 0 ? <button type="button" className="btn btn-secondary" onClick={() => void markAllRead()} disabled={pending}>{pending ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={14} />} 全部已读</button> : null}
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card metric-card"><div className="metric-label"><Bell size={15} /> 未读通知</div><div className="metric-value">{unread}</div><div className="metric-note">当前账号的未读站内通知</div></div>
        <div className="card metric-card"><div className="metric-label"><Inbox size={15} /> 全部通知</div><div className="metric-value">{notifications.length}</div><div className="metric-note">最多展示最近 100 条</div></div>
        <div className="card metric-card accent"><div className="metric-label"><CheckCheck size={15} /> 发送渠道</div><div className="metric-value" style={{ fontSize: 22, paddingTop: 7 }}>站内信 · STUB</div><div className="metric-note">后续可接入现有通知接口</div></div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="subtabbar">
            <button type="button" className={`subtab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>全部</button>
            <button type="button" className={`subtab ${filter === "unread" ? "active" : ""}`} onClick={() => setFilter("unread")}>未读 {unread > 0 ? `（${unread}）` : ""}</button>
          </div>
          <span className="hint">按发送时间倒序</span>
        </div>
        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Bell size={22} /></div>
            <h3>{filter === "unread" ? "没有未读通知" : "暂无通知"}</h3>
            <p>状态更新、责任转移、班次交接、审批等事件会按配置责任人发送通知。</p>
          </div>
        ) : (
          <div className="data-list" style={{ padding: "0 20px" }}>
            {visible.map((notification) => {
              let barcodeIds: string[] = [];
              try { barcodeIds = JSON.parse(notification.barcode_ids || "[]") as string[]; } catch { barcodeIds = []; }
              const href = notification.project_id
                ? barcodeIds.length > 0
                  ? `/projects/${notification.project_id}/issues?barcode=${barcodeIds[0]}`
                  : `/projects/${notification.project_id}`
                : "/projects";
              return (
                <Link
                  href={href}
                  key={notification.id}
                  className="data-row"
                  style={{ color: "inherit", alignItems: "flex-start", padding: "14px 0" }}
                  onClick={() => { if (!notification.read_at) void markOne(notification.id); }}
                >
                  <span className="status-dot" style={{ background: notification.read_at ? "var(--border-strong)" : "var(--primary)", marginTop: 7 }} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
                      <span className="title" style={{ fontSize: 13 }}>{notification.title}</span>
                      <span className="mini-meta">{formatDateTime(notification.created_at)}</span>
                    </div>
                    <div className="small muted" style={{ marginTop: 4, lineHeight: 1.65 }}>{notification.body}</div>
                    <div className="row" style={{ marginTop: 7, gap: 6 }}>
                      <span className="badge badge-outline">{notification.channel}</span>
                      <span className="badge badge-green">{notification.status}</span>
                      {notification.project_name ? <span className="mini-meta">项目：{notification.project_name}</span> : null}
                      {!notification.read_at ? <span className="badge badge-teal">未读</span> : null}
                    </div>
                  </div>
                  <ChevronRight size={15} color="var(--muted-2)" style={{ marginTop: 4 }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

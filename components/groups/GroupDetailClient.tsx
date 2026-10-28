"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Clock3,
  Info,
  LoaderCircle,
  Pencil,
  Plus,
  Shield,
  Trash2,
  TriangleAlert,
  UserPlus,
  UsersRound,
} from "lucide-react";
import type { GroupDetails } from "@/lib/groups";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime, todayLocal, weekdayLabel } from "@/lib/time";

interface GroupDetailClientProps {
  projectId: string;
  data: GroupDetails;
  isPm: boolean;
}

type TabKey = "members" | "schedules" | "overrides";

export function GroupDetailClient({ projectId, data, isPm }: GroupDetailClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("members");
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(data.group.name);
  const [description, setDescription] = useState(data.group.description || "");
  const [enabled, setEnabled] = useState(data.group.enabled);
  const [employeeNo, setEmployeeNo] = useState("");
  const [weekday, setWeekday] = useState("1");
  const [slotId, setSlotId] = useState(data.timeSlots[0]?.id || "");
  const [scheduleUserId, setScheduleUserId] = useState(data.members[0]?.userId || "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayLocal());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [overrideDate, setOverrideDate] = useState(todayLocal());
  const [overrideSlotId, setOverrideSlotId] = useState("");
  const [overrideUserId, setOverrideUserId] = useState(data.members[0]?.userId || "");
  const [overrideKind, setOverrideKind] = useState("TEMP");
  const [overrideNote, setOverrideNote] = useState("");
  const [actionError, setActionError] = useState("");

  const leaders = data.members.filter((member) => member.isLeader);
  const scheduleByDay = useMemo(() => {
    const map = new Map<number, typeof data.schedules>();
    for (let day = 1; day <= 7; day += 1) map.set(day, []);
    for (const schedule of data.schedules) map.get(schedule.weekday)?.push(schedule);
    return map;
  }, [data.schedules]);
  const base = `/projects/${projectId}`;
  const canManage = data.canManage;

  async function action(key: string, task: () => Promise<void>) {
    setBusy(key);
    setActionError("");
    try {
      await task();
      router.refresh();
    } catch (error) {
      const message = errorMessage(error);
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleFlag(userId: string, field: "isLeader" | "isDefaultAssignee" | "isFallbackAssignee", value: boolean) {
    await action(`flag-${userId}-${field}`, async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      toast.success("成员角色已更新");
    });
  }

  async function removeMember(userId: string, memberName: string) {
    if (!window.confirm(`确定将「${memberName}」移出该责任组吗？系统会按当前排班重新解析其名下本组问题。`)) return;
    await action(`remove-${userId}`, async () => {
      const result = await apiFetch<{ reassignedIssues: number }>(`/api/projects/${projectId}/groups/${data.group.id}/members/${userId}`, { method: "DELETE" });
      toast.success(`成员已移出${result.reassignedIssues > 0 ? `，已重新解析 ${result.reassignedIssues} 个问题的本组处理人` : ""}`);
    });
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    await action("add-member", async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/members`, {
        method: "POST",
        body: JSON.stringify({ employeeNo }),
      });
      setEmployeeNo("");
      toast.success("成员已加入责任组");
    });
  }

  async function addSchedule(event: React.FormEvent) {
    event.preventDefault();
    await action("add-schedule", async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/schedules`, {
        method: "POST",
        body: JSON.stringify({
          weekday: Number(weekday),
          slotId,
          userId: scheduleUserId,
          effectiveFrom,
          effectiveTo: effectiveTo || null,
        }),
      });
      toast.success("排班已添加；当前班次已分配的问题不自动变化，将在下一次班次交接时生效");
    });
  }

  async function deleteSchedule(id: string) {
    if (!window.confirm("确定删除这条排班吗？")) return;
    await action(`delete-schedule-${id}`, async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/schedules/${id}`, { method: "DELETE" });
      toast.success("排班已删除");
    });
  }

  async function addOverride(event: React.FormEvent) {
    event.preventDefault();
    await action("add-override", async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/overrides`, {
        method: "POST",
        body: JSON.stringify({
          overrideDate,
          slotId: overrideSlotId || null,
          userId: overrideUserId,
          kind: overrideKind,
          note: overrideNote,
        }),
      });
      setOverrideNote("");
      toast.success("调班已保存；到对应班次交接时会按临时配置解析处理人");
    });
  }

  async function deleteOverride(id: string) {
    if (!window.confirm("确定删除这条临时调班吗？")) return;
    await action(`delete-override-${id}`, async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}/overrides/${id}`, { method: "DELETE" });
      toast.success("临时调班已删除");
    });
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();
    await action("save-group", async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description, ...(isPm ? { enabled } : {}) }),
      });
      setEditOpen(false);
      toast.success("责任组信息已更新");
    });
  }

  async function deleteGroup() {
    await action("delete-group", async () => {
      await apiFetch(`/api/projects/${projectId}/groups/${data.group.id}`, { method: "DELETE" });
      toast.success("责任组已删除");
      router.push(`${base}/groups`);
      router.refresh();
    });
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div>
        <Link href={`${base}/groups`} className="link-btn" style={{ marginBottom: 12 }}><ArrowLeft size={13} /> 返回责任组</Link>
        <div className="page-header">
          <div>
            <div className="page-kicker">Responsibility Group</div>
            <div className="row" style={{ gap: 9 }}>
              <h1 className="page-title">{data.group.name}</h1>
              <span className={`badge ${data.group.enabled ? "badge-green" : "badge-neutral"}`}>{data.group.enabled ? "启用中" : "已停用"}</span>
            </div>
            <p className="page-sub">{data.group.description || "暂无描述"} · 当前参与问题 {data.activeIssueCount} 个</p>
            <div className="row" style={{ marginTop: 9, gap: 6 }}>
              {leaders.map((leader) => <span key={leader.userId} className="chip"><Shield size={11} /> {leader.name} · 负责人</span>)}
              {leaders.length === 0 ? <span className="badge badge-red">缺少负责人，请尽快配置</span> : null}
            </div>
          </div>
          <div className="header-actions">
            <Link href={`${base}/communication?group=${data.group.id}`} className="btn btn-secondary"><CalendarDays size={14} /> 查看沟通地图</Link>
            {canManage ? <button type="button" className="btn btn-primary" onClick={() => setEditOpen(true)}><Pencil size={14} /> 编辑责任组</button> : null}
            {isPm ? <button type="button" className="icon-btn" title="删除责任组" onClick={() => setDeleteOpen(true)} disabled={busy !== null}><Trash2 size={15} /></button> : null}
          </div>
        </div>
      </div>

      {!canManage ? <div className="callout-strip"><Info size={14} /> 你对该责任组为只读视图。仅项目 PM 和本组负责人可维护成员与排班。</div> : null}
      {actionError ? <div className="alert alert-error">{actionError}</div> : null}

      <div className="card">
        <div className="tabbar" style={{ padding: "0 14px" }}>
          <button type="button" className={`tab ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}><UsersRound size={14} /> 成员与角色</button>
          <button type="button" className={`tab ${tab === "schedules" ? "active" : ""}`} onClick={() => setTab("schedules")}><CalendarClock size={14} /> 星期排班</button>
          <button type="button" className={`tab ${tab === "overrides" ? "active" : ""}`} onClick={() => setTab("overrides")}><Clock3 size={14} /> 临时调班</button>
        </div>

        {tab === "members" ? (
          <div className="card-body">
            <div className="section-toolbar">
              <div>
                <div className="panel-title" style={{ marginBottom: 2 }}>组内成员与默认角色</div>
                <div className="hint">组长可维护接口人；排班缺失时，组负责人、默认处理人、兜底处理人及项目 PM 共同兜底。</div>
              </div>
            </div>
            {data.members.length === 0 ? <div className="empty-mini">暂无成员，请先添加组内成员。</div> : (
              <div>
                {data.members.map((member) => (
                  <div className="group-member-row" key={member.userId}>
                    <span className="avatar" style={{ width: 31, height: 31 }}>{member.name.slice(0, 1)}</span>
                    <div className="member-main">
                      <div className="member-name">{member.name} <span className="mini-meta mono">{member.employeeNo}</span></div>
                      <div className="member-meta">待处理 {member.pending} · 协办 {member.coordination}</div>
                    </div>
                    <div className="member-role-toggles">
                      <button type="button" className={`role-pill leader ${member.isLeader ? "on" : ""}`} disabled={!canManage || busy !== null} onClick={() => void toggleFlag(member.userId, "isLeader", !member.isLeader)}>
                        {member.isLeader ? "✓ " : ""}组负责人
                      </button>
                      <button type="button" className={`role-pill ${member.isDefaultAssignee ? "on" : ""}`} disabled={!canManage || busy !== null} onClick={() => void toggleFlag(member.userId, "isDefaultAssignee", !member.isDefaultAssignee)}>
                        {member.isDefaultAssignee ? "✓ " : ""}默认处理人
                      </button>
                      <button type="button" className={`role-pill ${member.isFallbackAssignee ? "on" : ""}`} disabled={!canManage || busy !== null} onClick={() => void toggleFlag(member.userId, "isFallbackAssignee", !member.isFallbackAssignee)}>
                        {member.isFallbackAssignee ? "✓ " : ""}兜底处理人
                      </button>
                    </div>
                    {canManage ? (
                      <button type="button" className="icon-btn danger" title="移出责任组" onClick={() => void removeMember(member.userId, member.name)} disabled={busy !== null}>
                        {busy === `remove-${member.userId}` ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {canManage ? (
              <form onSubmit={addMember} className="inline-form" style={{ marginTop: 16, paddingTop: 15, borderTop: "1px solid var(--border)" }}>
                <div className="field" style={{ maxWidth: 280 }}>
                  <label>添加组内成员</label>
                  <input className="input" value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} placeholder="输入该成员的登录工号" required />
                  <div className="field-hint">若该用户还未参与项目，加入本组后自动获得项目访问权。</div>
                </div>
                <button type="submit" className="btn btn-secondary" disabled={busy !== null || !employeeNo.trim()}><UserPlus size={14} /> 添加成员</button>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "schedules" ? (
          <div className="card-body">
            <div className="section-toolbar">
              <div>
                <div className="panel-title" style={{ marginBottom: 2 }}>按星期与班次排班</div>
                <div className="hint">支持同一责任组在不同星期配置不同处理人；同一班次可配置多人。默认按生效日期起长期有效。</div>
              </div>
            </div>
            {data.timeSlots.length === 0 ? <div className="alert alert-warning">项目尚未配置时间模板，请联系项目 PM 在项目配置中新增班次。</div> : null}
            <div className="schedule-grid">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <div className="schedule-day-col" key={day}>
                  <div className="schedule-day-head">{weekdayLabel(day)}</div>
                  <div className="schedule-day-body">
                    {(scheduleByDay.get(day) || []).length === 0 ? <div className="schedule-none">无排班</div> : (scheduleByDay.get(day) || []).map((schedule) => (
                      <div className="schedule-chip" key={schedule.id} title={`${schedule.slotName} ${schedule.timeLabel} · 生效：${schedule.effectiveFrom} 至 ${schedule.effectiveTo || "长期"}`}>
                        <span className="slot">{schedule.slotName} {schedule.timeLabel}</span>
                        <span className="who">{schedule.userName}</span>
                        <span style={{ float: "right", color: "var(--muted-2)", fontSize: 9 }}>
                          {schedule.effectiveTo ? `至 ${schedule.effectiveTo}` : ""}
                          {canManage ? (
                            <button type="button" onClick={() => void deleteSchedule(schedule.id)} disabled={busy !== null} style={{ border: 0, background: "none", color: "var(--muted-2)", padding: "0 0 0 3px" }} title="删除排班">×</button>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {canManage ? (
              <form onSubmit={addSchedule} className="form-grid" style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <div className="field">
                  <label>星期</label>
                  <select className="select" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>{weekdayLabel(day)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>班次</label>
                  <select className="select" value={slotId} onChange={(event) => setSlotId(event.target.value)}>
                    {data.timeSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}（{String(Math.floor(slot.start_minute / 60)).padStart(2, "0")}:{String(slot.start_minute % 60).padStart(2, "0")}–{String(Math.floor(slot.end_minute / 60)).padStart(2, "0")}:{String(slot.end_minute % 60).padStart(2, "0")}）</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>处理人</label>
                  <select className="select" value={scheduleUserId} onChange={(event) => setScheduleUserId(event.target.value)}>
                    <option value="">请选择本组成员</option>
                    {data.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}（{member.employeeNo}）</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>生效开始</label>
                  <input type="date" className="input" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required />
                </div>
                <div className="field">
                  <label>生效结束</label>
                  <input type="date" className="input" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
                  <div className="field-hint">留空表示长期有效</div>
                </div>
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <button type="submit" className="btn btn-primary" disabled={busy !== null || !slotId || !scheduleUserId}><Plus size={14} /> 添加排班</button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        {tab === "overrides" ? (
          <div className="card-body">
            <div className="section-toolbar">
              <div>
                <div className="panel-title" style={{ marginBottom: 2 }}>节假日覆盖 / 临时调班 / 代理值班</div>
                <div className="hint">按具体日期覆盖星期模板，不修改星期模板。跨夜班次请填写班次开始日期。</div>
              </div>
            </div>
            {data.overrides.length === 0 ? <div className="empty-mini">暂无临时调班记录。</div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>日期</th><th>班次</th><th>处理人</th><th>类型</th><th>备注</th><th></th></tr></thead>
                  <tbody>
                    {data.overrides.map((override) => (
                      <tr key={override.id}>
                        <td className="mono">{override.overrideDate}</td>
                        <td>{override.slotName || "全部班次"}</td>
                        <td>{override.userName} <span className="mini-meta">{override.employeeNo}</span></td>
                        <td><span className="badge badge-blue">{override.kindLabel}</span></td>
                        <td className="muted">{override.note || "—"}</td>
                        <td className="actions">{canManage ? <button type="button" className="icon-btn danger" onClick={() => void deleteOverride(override.id)} disabled={busy !== null}><Trash2 size={13} /></button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canManage ? (
              <form onSubmit={addOverride} className="form-grid" style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <div className="field">
                  <label>日期（班次开始日）</label>
                  <input type="date" className="input" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} required />
                </div>
                <div className="field">
                  <label>覆盖班次</label>
                  <select className="select" value={overrideSlotId} onChange={(event) => setOverrideSlotId(event.target.value)}>
                    <option value="">全部班次</option>
                    {data.timeSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>处理人</label>
                  <select className="select" value={overrideUserId} onChange={(event) => setOverrideUserId(event.target.value)}>
                    <option value="">请选择本组成员</option>
                    {data.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}（{member.employeeNo}）</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>调班类型</label>
                  <select className="select" value={overrideKind} onChange={(event) => setOverrideKind(event.target.value)}>
                    <option value="TEMP">临时调班</option>
                    <option value="HOLIDAY">节假日覆盖</option>
                    <option value="PROXY">代理值班</option>
                  </select>
                </div>
                <div className="field full">
                  <label>说明</label>
                  <input className="input" value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} maxLength={200} placeholder="例如：张伟请假，由李娜代理白班" />
                </div>
                <div className="field">
                  <button type="submit" className="btn btn-primary" disabled={busy !== null || !overrideUserId}><Plus size={14} /> 保存调班</button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">排班缺失与兜底提醒</h2>
            <div className="section-sub">系统在录入、转接和班次交接时，若无法解析排班将记录异常，并兜底至负责人、默认/兜底处理人与项目 PM。</div>
          </div>
          <span className="badge badge-amber">{data.anomalies.length} 条</span>
        </div>
        <div className="card-body">
          {data.anomalies.length === 0 ? <div className="empty-mini">暂无排班异常记录。</div> : (
            <div className="anomaly-list">
              {data.anomalies.map((anomaly) => (
                <div className="anomaly-item" key={anomaly.id}>
                  <div>{anomaly.message}{anomaly.barcode ? ` · ${anomaly.barcode}` : ""}</div>
                  <div className="time">{formatDateTime(anomaly.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isPm ? (
        <div className="card" style={{ borderColor: "#f0d5d5" }}>
          <div className="card-header">
            <div><h2 className="section-title" style={{ color: "var(--danger)" }}>危险操作</h2><div className="section-sub">删除责任组前必须确保没有进行中的问题；停用组后不再参与新问题路由。</div></div>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(true)} disabled={busy !== null}><Trash2 size={14} /> 删除责任组</button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <Modal
          title="编辑责任组"
          description="组负责人可修改责任组名称和描述；启用/停用由项目 PM 控制。"
          onClose={() => (busy ? null : setEditOpen(false))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={busy !== null}>取消</button>
            <button type="submit" form="edit-group-form" className="btn btn-primary" disabled={busy !== null}>{busy === "save-group" ? "保存中…" : "保存"}</button>
          </>}
        >
          <form id="edit-group-form" onSubmit={saveGroup} className="stack-sm">
            <div className="field"><label>责任组名称</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={50} /></div>
            <div className="field"><label>描述</label><textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} /></div>
            {isPm ? (
              <div className="toggle-row" style={{ paddingTop: 4 }}>
                <div><div className="title">启用责任组</div><div className="desc">停用前必须先将该组当前所有问题转出。</div></div>
                <label className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span /></label>
              </div>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {deleteOpen ? (
        <Modal
          title="删除责任组"
          description={`确定删除责任组「${data.group.name}」吗？`}
          size="sm"
          onClose={() => (busy ? null : setDeleteOpen(false))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setDeleteOpen(false)} disabled={busy !== null}>取消</button>
            <button type="button" className="btn btn-danger" onClick={() => void deleteGroup()} disabled={busy !== null}>{busy === "delete-group" ? "删除中…" : "确认删除"}</button>
          </>}
        >
          <div className="alert alert-warning"><TriangleAlert size={15} /> 仅当该组当前没有参与问题时才能删除。删除后成员、排班和调班配置一并移除，历史责任人路径保留在问题记录中。</div>
        </Modal>
      ) : null}
    </div>
  );
}
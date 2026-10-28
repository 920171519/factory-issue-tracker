"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Clock3,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  Shield,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { formatDateTime, weekdayLabel, weekdayOfDate } from "@/lib/time";

interface SerializedResolution {
  groupId: string;
  groupName: string;
  handlerIds: string[];
  handlers: { id: string; name: string; employee_no: string }[];
  primaryId: string | null;
  source: "SCHEDULE" | "OVERRIDE" | "FALLBACK";
  sourceLabel: string;
  fallbackReason: string | null;
  slot: { id: string; name: string; start_minute: number; end_minute: number } | null;
  anchorDate: string | null;
  anchorWeekday: number | null;
  overrideKind?: string;
  overrideNote?: string | null;
}

interface CommunicationGroupDto {
  id: string;
  name: string;
  enabled: boolean;
  leaders: { id: string; name: string; employeeNo: string }[];
  members: { id: string; name: string; employeeNo: string; isLeader: boolean }[];
  schedules: { weekday: number; weekdayLabel: string; slotName: string; timeLabel: string; users: string[] }[];
  resolution: SerializedResolution | null;
}

interface CommunicationDto {
  date: string;
  time: string;
  timeSlots: { id: string; name: string; startMinute: number; endMinute: number; timeLabel: string }[];
  groups: CommunicationGroupDto[];
  holiday: { name: string; date: string } | null;
}

interface CommunicationClientProps {
  projectId: string;
  initialData: CommunicationDto;
  initialGroupFilter?: string;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function CommunicationClient({ projectId, initialData, initialGroupFilter }: CommunicationClientProps) {
  const [data, setData] = useState(initialData);
  const [date, setDate] = useState(initialData.date);
  const [time, setTime] = useState(initialData.time);
  const [groupFilter, setGroupFilter] = useState(initialGroupFilter || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredGroups = useMemo(() => {
    const query = groupFilter.trim().toLowerCase();
    return data.groups.filter((group) => !query || group.name.toLowerCase().includes(query));
  }, [data.groups, groupFilter]);

  const simulatedWeekday = weekdayOfDate(date);

  async function simulate(next?: { date?: string; time?: string }) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ date: next?.date || date, time: next?.time || time });
      const result = await apiFetch<{ communication: CommunicationDto }>(`/api/projects/${projectId}/communication?${params.toString()}`);
      setData(result.communication);
      setDate(result.communication.date);
      setTime(result.communication.time);
    } catch (simulateError) {
      setError(errorMessage(simulateError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Communication Map</div>
          <h1 className="page-title">沟通地图</h1>
          <p className="page-sub">查看各责任组负责人、组内接口人和按星期/时间段维护的排班，并按指定日期与时间模拟当前班次责任人。</p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-secondary" href={`/projects/${projectId}/groups`}><UsersRound size={14} /> 管理责任组</Link>
        </div>
      </div>

      <div className="sim-card">
        <div className="section-head" style={{ marginBottom: 15, position: "relative", zIndex: 1 }}>
          <div>
            <h2 className="section-title" style={{ color: "#f4fbfb" }}>模拟当前排班</h2>
            <div className="section-sub" style={{ color: "#8eafbb" }}>日期 + 时间决定星期、班次与轮班生效范围；节假日临时调班按具体日期覆盖模板。</div>
          </div>
          {data.holiday ? <span className="badge badge-amber">{data.holiday.name} · {data.holiday.date}</span> : null}
        </div>
        <div className="sim-form">
          <div className="field">
            <label htmlFor="sim-date">模拟日期</label>
            <input id="sim-date" type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sim-time">模拟时间</label>
            <input id="sim-time" type="time" className="input" value={time} onChange={(event) => setTime(event.target.value)} />
          </div>
          <div className="field">
            <label>责任组筛选</label>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#7296a4" }} />
              <input className="input" style={{ paddingLeft: 32 }} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} placeholder="输入责任组名称筛选" />
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void simulate()} disabled={loading}>
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            {loading ? "解析中…" : "模拟查看"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 14, position: "relative", zIndex: 1, gap: 6 }}>
          <span className="hint" style={{ color: "#87a9b5" }}>班次快捷：</span>
          {data.timeSlots.map((slot) => (
            <button key={slot.id} type="button" className="btn btn-sm" style={{ background: "rgba(255,255,255,.08)", color: "#dceff1", borderColor: "rgba(255,255,255,.12)" }} onClick={() => { setTime(minutesToTime(slot.startMinute)); void simulate({ time: minutesToTime(slot.startMinute) }); }}>
              {slot.name} {slot.timeLabel}
            </button>
          ))}
        </div>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="row" style={{ gap: 10 }}>
        <span className="badge badge-teal"><CalendarDays size={12} /> {data.date} · {weekdayLabel(simulatedWeekday)} · {data.time}</span>
        <span className="comm-legend"><span><span className="status-dot" style={{ display: "inline-block", background: "var(--primary)", marginRight: 4 }} />主处理人</span><span>按当前班次解析 · 非状态驱动</span></span>
        <span className="spacer" />
        <span className="hint">显示 {filteredGroups.length} / {data.groups.length} 个责任组</span>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="card empty-state"><div className="empty-icon"><Search size={20} /></div><h3>没有匹配的责任组</h3><p>调整责任组筛选条件后重试。</p></div>
      ) : (
        <div className="comm-grid">
          {filteredGroups.map((group) => {
            const isExpanded = expanded[group.id];
            return (
              <div className="comm-card" key={group.id}>
                <div className="comm-card-head">
                  <div>
                    <div className="row" style={{ gap: 7 }}>
                      <h3>{group.name}</h3>
                      <span className={`badge ${group.enabled ? "badge-green" : "badge-neutral"}`}>{group.enabled ? "启用中" : "已停用"}</span>
                    </div>
                    <div className="leaders">
                      {group.leaders.length > 0 ? group.leaders.map((leader) => `${leader.name}（负责人）`).join("、") : "暂无负责人"}
                    </div>
                  </div>
                  <span className="mini-avatar" style={{ width: 29, height: 29 }}><UsersRound size={13} /></span>
                </div>
                <div className="comm-resolution">
                  <div className="label">当前班次配置责任人</div>
                  {!group.enabled ? (
                    <div className="hint">责任组已停用，不参与新问题路由。</div>
                  ) : group.resolution ? (
                    <>
                      <div className="resolved-handlers">
                        {group.resolution.handlers.length === 0 ? <span className="hint">无解析出的处理人</span> : group.resolution.handlers.map((handler) => (
                          <span key={handler.id} className={`resolved-chip ${handler.id === group.resolution?.primaryId ? "primary" : ""}`}>
                            {handler.name}
                            <small>{handler.id === group.resolution?.primaryId ? "主处理" : "配置责任人"}</small>
                          </span>
                        ))}
                      </div>
                      <div className="row" style={{ marginTop: 9, gap: 6 }}>
                        <span className="badge badge-outline">{group.resolution.sourceLabel}</span>
                        {group.resolution.slot ? <span className="badge badge-neutral">{group.resolution.slot.name} {group.resolution.anchorWeekday ? weekdayLabel(group.resolution.anchorWeekday) : ""}</span> : null}
                        {group.resolution.overrideNote ? <span className="hint">{group.resolution.overrideNote}</span> : null}
                      </div>
                      {group.resolution.source === "FALLBACK" ? (
                        <div className="alert alert-warning" style={{ marginTop: 8, padding: "7px 9px" }}>
                          <TriangleAlert size={13} />
                          {group.resolution.fallbackReason || "排班缺失"}，已兜底至组负责人、默认/兜底处理人与项目 PM。
                        </div>
                      ) : null}
                    </>
                  ) : <span className="hint">无法解析当前班次责任人或该组已停用。</span>}
                </div>
                <div style={{ padding: "10px 16px" }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 7 }}>
                    <button type="button" className="link-btn" onClick={() => setExpanded((current) => ({ ...current, [group.id]: !current[group.id] }))}>
                      {isExpanded ? "收起" : "查看"}星期排班
                    </button>
                    <div className="week-mini">
                      {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                        <span key={day} className={group.schedules.some((schedule) => schedule.weekday === day) ? "has" : ""} title={weekdayLabel(day)}>
                          {weekdayLabel(day).replace("周", "")}
                        </span>
                      ))}
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="stack-sm" style={{ marginTop: 7 }}>
                      {group.schedules.length === 0 ? <div className="empty-mini">该组暂无排班。</div> : group.schedules.map((schedule, index) => (
                        <div key={`${group.id}-${index}`} className="schedule-chip">
                          <span className="slot">{schedule.weekdayLabel} · {schedule.slotName} {schedule.timeLabel}</span>
                          <span className="who">{schedule.users.join("、")}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="comm-card-foot">
                  <span><UsersRound size={11} style={{ verticalAlign: "-1px" }} /> {group.members.length} 位成员</span>
                  <span><Clock3 size={11} style={{ verticalAlign: "-1px" }} /> 按星期 / 班次</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="callout-strip">
        <Info size={15} /> 状态变化不会影响这里的责任路由。责任人仅由录入分配、组内转交、跨组转接、班次交接与兜底分配决定。
      </div>
    </div>
  );
}

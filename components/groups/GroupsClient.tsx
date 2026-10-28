"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CalendarClock, Plus, TriangleAlert, UserRound, UsersRound } from "lucide-react";
import type { GroupCard } from "@/lib/groups";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";

interface GroupsClientProps {
  projectId: string;
  groups: GroupCard[];
  memberOptions: { id: string; name: string; employeeNo: string }[];
  isPm: boolean;
}

export function GroupsClient({ projectId, groups, memberOptions, isPm }: GroupsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leaderIds, setLeaderIds] = useState<string[]>([]);
  const [defaultAssigneeId, setDefaultAssigneeId] = useState("");
  const [fallbackAssigneeId, setFallbackAssigneeId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function toggleLeader(id: string) {
    setLeaderIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (leaderIds.length === 0) {
      setError("新增责任组必须配置至少一名组负责人");
      return;
    }
    setPending(true);
    try {
      const result = await apiFetch<{ id: string }>(`/api/projects/${projectId}/groups`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          leaderIds,
          defaultAssigneeId: defaultAssigneeId || null,
          fallbackAssigneeId: fallbackAssigneeId || null,
        }),
      });
      toast.success("责任组已创建，请继续维护组内成员与排班");
      setOpen(false);
      router.push(`/projects/${projectId}/groups/${result.id}`);
      router.refresh();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Organization</div>
          <h1 className="page-title">责任组与排班</h1>
          <p className="page-sub">责任组是问题归属、分发、排班和通知的唯一单位。组负责人维护本组接口人、默认/兜底处理人及按星期排班。</p>
        </div>
        {isPm ? (
          <div className="header-actions">
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={15} /> 新增责任组</button>
          </div>
        ) : null}
      </div>

      <div className="callout-strip">
        <CalendarClock size={15} /> 当前排班由「责任组 + 星期 + 时间段 + 生效日期」解析；临时调班按具体日期覆盖星期模板，不修改模板。跨班次系统自动交接。
      </div>

      {groups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon"><UsersRound size={22} /></div>
          <h3>还没有责任组</h3>
          <p>{isPm ? "创建责任组并指定组负责人后，可配置成员和排班。" : "请联系项目 PM 创建责任组并配置负责人。"}</p>
          {isPm ? <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setOpen(true)}><Plus size={15} /> 新增责任组</button> : null}
        </div>
      ) : (
        <div className="groups-grid">
          {groups.map((group) => (
            <div className="card group-card" key={group.id}>
              <div className="group-card-top">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div className="row" style={{ gap: 7 }}>
                      <h3>{group.name}</h3>
                      <span className={`badge ${group.enabled ? "badge-green" : "badge-neutral"}`}>{group.enabled ? "启用中" : "已停用"}</span>
                    </div>
                    <div className="desc">{group.description || "暂无描述"}</div>
                  </div>
                  <span className="mini-avatar" style={{ width: 30, height: 30 }}><UsersRound size={14} /></span>
                </div>
                <div className="meta">
                  <span><CalendarClock size={11} style={{ verticalAlign: "-1px" }} /> {group.scheduleCount} 条星期排班</span>
                  <span>参与问题 {group.activeIssueCount}</span>
                </div>
                <div className="group-leaders">
                  {group.leaders.length === 0 ? <span className="badge badge-red">缺少负责人</span> : group.leaders.map((leader) => (
                    <span className="chip" key={leader.id}><UserRound size={11} /> {leader.name} · 负责人</span>
                  ))}
                  {group.defaultAssignee ? <span className="chip">默认：{group.defaultAssignee.name}</span> : null}
                  {group.fallbackAssignee ? <span className="chip">兜底：{group.fallbackAssignee.name}</span> : null}
                </div>
              </div>
              <div className="group-card-metrics">
                <div className="group-metric"><div className="n">{group.memberCount}</div><div className="l">组内成员</div></div>
                <div className="group-metric"><div className="n">{group.scheduleCount}</div><div className="l">排班记录</div></div>
                <div className="group-metric"><div className="n">{group.activeIssueCount}</div><div className="l">当前问题</div></div>
              </div>
              <div className="group-card-foot">
                <div className="resolution">
                  {group.currentResolution ? (
                    group.currentResolution.source === "FALLBACK" ? (
                      <span style={{ color: "var(--warning)" }}><TriangleAlert size={11} style={{ verticalAlign: "-1px" }} /> 当前兜底</span>
                    ) : (
                      <>当前：<b>{group.currentResolution.handlers.map((handler) => handler.name).join("、") || "—"}</b></>
                    )
                  ) : "当前未启用"}
                </div>
                <Link className="link-btn" href={`/projects/${projectId}/groups/${group.id}`}>
                  {group.canManage ? "管理" : "查看"} <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <Modal
          title="新增责任组"
          description="新增责任组必须指定组负责人；配置完成后由组负责人维护成员、默认/兜底处理人及排班。"
          size="lg"
          onClose={() => (pending ? null : setOpen(false))}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>取消</button>
            <button type="submit" form="create-group-form" className="btn btn-primary" disabled={pending}>{pending ? "创建中…" : "创建责任组"}</button>
          </>}
        >
          <form id="create-group-form" onSubmit={submit} className="form-grid">
            <div className="field full">
              <label>责任组名称 <span className="required">*</span></label>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 CPU 测试组、风扇测试组" required maxLength={50} autoFocus />
            </div>
            <div className="field full">
              <label>责任组描述</label>
              <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="负责范围、协作说明等" />
            </div>
            <div className="field full">
              <label>组负责人 <span className="required">*</span></label>
              {memberOptions.length === 0 ? <div className="alert alert-warning">当前项目暂无其他成员，请先在「项目成员」中添加成员。</div> : (
                <div className="choice-grid">
                  {memberOptions.map((member) => (
                    <label className={`choice ${leaderIds.includes(member.id) ? "selected" : ""}`} key={member.id}>
                      <input type="checkbox" checked={leaderIds.includes(member.id)} onChange={() => toggleLeader(member.id)} />
                      <span><strong>{member.name}</strong><small>{member.employeeNo}</small></span>
                    </label>
                  ))}
                </div>
              )}
              <div className="field-hint">可设多名负责人；组负责人可以维护本组接口人、排班并执行组内转交/跨组转接。</div>
            </div>
            <div className="field">
              <label>默认处理人</label>
              <select className="select" value={defaultAssigneeId} onChange={(event) => setDefaultAssigneeId(event.target.value)}>
                <option value="">不设置</option>
                {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}（{member.employeeNo}）</option>)}
              </select>
              <div className="field-hint">排班缺失时与负责人、兜底处理人、项目 PM 一起参与兜底。</div>
            </div>
            <div className="field">
              <label>兜底处理人</label>
              <select className="select" value={fallbackAssigneeId} onChange={(event) => setFallbackAssigneeId(event.target.value)}>
                <option value="">不设置</option>
                {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}（{member.employeeNo}）</option>)}
              </select>
            </div>
            {error ? <div className="alert alert-error full">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

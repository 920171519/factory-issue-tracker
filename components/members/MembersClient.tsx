"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContactRound, LoaderCircle, ShieldCheck, Trash2, UserPlus, UsersRound } from "lucide-react";
import type { ProjectMemberView } from "@/lib/projects";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface MembersClientProps {
  projectId: string;
  members: ProjectMemberView[];
  isPm: boolean;
}

export function MembersClient({ projectId, members, isPm }: MembersClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [employeeNo, setEmployeeNo] = useState("");
  const [newIsPm, setNewIsPm] = useState(false);
  const [newIsSupervisor, setNewIsSupervisor] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pmCount = members.filter((member) => member.isPm).length;
  const supervisorCount = members.filter((member) => member.isSupervisor).length;

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy("add");
    try {
      await apiFetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ employeeNo, isPm: newIsPm, isSupervisor: newIsSupervisor }),
      });
      setEmployeeNo("");
      setNewIsPm(false);
      setNewIsSupervisor(false);
      toast.success("项目成员已添加");
      router.refresh();
    } catch (addError) {
      setError(errorMessage(addError));
      toast.error(errorMessage(addError));
    } finally {
      setBusy(null);
    }
  }

  async function updateRoles(member: ProjectMemberView, next: { isPm: boolean; isSupervisor: boolean }) {
    setError("");
    setBusy(`role-${member.userId}`);
    try {
      await apiFetch(`/api/projects/${projectId}/members/${member.userId}`, {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      toast.success("成员角色已更新");
      router.refresh();
    } catch (updateError) {
      setError(errorMessage(updateError));
      toast.error(errorMessage(updateError));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: ProjectMemberView) {
    if (!window.confirm(`确定将「${member.name}」移出项目吗？若其仍属于责任组或仍是问题处理人，系统会阻止该操作。`)) return;
    setError("");
    setBusy(`remove-${member.userId}`);
    try {
      await apiFetch(`/api/projects/${projectId}/members/${member.userId}`, { method: "DELETE" });
      toast.success("成员已移出项目");
      router.refresh();
    } catch (removeError) {
      setError(errorMessage(removeError));
      toast.error(errorMessage(removeError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Members</div>
          <h1 className="page-title">项目成员</h1>
          <p className="page-sub">项目 PM 和项目主管可查看全部项目成员。只有项目 PM 可维护成员角色；责任组内成员可由组负责人维护。</p>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card metric-card"><div className="metric-label"><ContactRound size={15} /> 项目成员</div><div className="metric-value">{members.length}</div><div className="metric-note">可访问当前项目的全部账号</div></div>
        <div className="card metric-card"><div className="metric-label"><ShieldCheck size={15} /> 项目 PM</div><div className="metric-value">{pmCount}</div><div className="metric-note">可审批删除、管理全部配置</div></div>
        <div className="card metric-card"><div className="metric-label"><UsersRound size={15} /> 项目主管</div><div className="metric-value">{supervisorCount}</div><div className="metric-note">全量信息可见，可强制转交</div></div>
        <div className="card metric-card"><div className="metric-label"><UsersRound size={15} /> 组负责人</div><div className="metric-value">{members.filter((member) => member.groups.some((group) => group.isLeader)).length}</div><div className="metric-note">同时担任至少一个责任组负责人</div></div>
      </div>

      {!isPm ? <div className="callout-strip"><ShieldCheck size={14} /> 当前为只读成员视图；新增成员与角色维护仅项目 PM 可操作。</div> : (
        <form className="card card-pad" onSubmit={addMember}>
          <div className="panel-title">添加项目成员</div>
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 280 }}>
              <label>登录工号</label>
              <input className="input" value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} placeholder="成员已注册的系统工号" required />
            </div>
            <label className="checkbox-line" style={{ minHeight: 38 }}><input type="checkbox" checked={newIsPm} onChange={(event) => setNewIsPm(event.target.checked)} /> 项目 PM</label>
            <label className="checkbox-line" style={{ minHeight: 38 }}><input type="checkbox" checked={newIsSupervisor} onChange={(event) => setNewIsSupervisor(event.target.checked)} /> 项目主管</label>
            <button type="submit" className="btn btn-primary" disabled={busy !== null}><UserPlus size={14} /> 添加成员</button>
          </div>
          <div className="field-hint" style={{ marginTop: 7 }}>成员须先注册账号。责任组负责人也可在组内通过工号添加成员，届时会自动加入项目。</div>
        </form>
      )}

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>成员</th><th>项目角色</th><th>责任组</th><th>待处理 / 协办</th><th>加入时间</th>{isPm ? <th></th> : null}</tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <span className="avatar" style={{ width: 31, height: 31 }}>{member.name.slice(0, 1)}</span>
                      <div><div className="main-cell">{member.name}</div><div className="mini-meta mono">{member.employeeNo}</div></div>
                    </div>
                  </td>
                  <td>
                    {isPm ? (
                      <div className="row" style={{ gap: 4 }}>
                        <button type="button" className={`role-pill ${member.isPm ? "on" : ""}`} disabled={busy !== null} onClick={() => void updateRoles(member, { isPm: !member.isPm, isSupervisor: member.isSupervisor })}>{member.isPm ? "✓ " : ""}项目 PM</button>
                        <button type="button" className={`role-pill ${member.isSupervisor ? "on" : ""}`} disabled={busy !== null} onClick={() => void updateRoles(member, { isPm: member.isPm, isSupervisor: !member.isSupervisor })}>{member.isSupervisor ? "✓ " : ""}项目主管</button>
                        {busy === `role-${member.userId}` ? <LoaderCircle size={13} className="spin" /> : null}
                      </div>
                    ) : (
                      <div className="chip-list">
                        {member.isPm ? <span className="badge badge-teal">项目 PM</span> : null}
                        {member.isSupervisor ? <span className="badge badge-blue">项目主管</span> : null}
                        {!member.isPm && !member.isSupervisor ? <span className="badge badge-neutral">成员</span> : null}
                      </div>
                    )}
                  </td>
                  <td>
                    {member.groups.length === 0 ? <span className="hint">未加入责任组</span> : (
                      <div className="chip-list">
                        {member.groups.map((group) => (
                          <Link key={group.id} href={`/projects/${projectId}/groups/${group.id}`} className="chip" style={{ color: "var(--ink-soft)" }}>
                            {group.name}{group.isLeader ? <span style={{ color: "var(--primary)" }}> · 负责人</span> : ""}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td><span className="mono">{member.pending}</span> <span className="hint">/ {member.coordination}</span></td>
                  <td className="mini-meta">{formatDateTime(member.joinedAt, { dateOnly: true })}</td>
                  {isPm ? (
                    <td className="actions">
                      <button type="button" className="icon-btn danger" title="移出项目" onClick={() => void removeMember(member)} disabled={busy !== null}>
                        {busy === `remove-${member.userId}` ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

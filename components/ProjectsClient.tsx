"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  ClipboardList,
  FolderKanban,
  Plus,
  ShieldCheck,
  Ticket,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
import { Modal } from "@/components/Modal";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";

interface ProjectsClientProps {
  projects: ProjectSummary[];
  userName: string;
  canCreateProject: boolean;
}

export function ProjectsClient({ projects, userName, canCreateProject }: ProjectsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const totalPending = projects.reduce((sum, project) => sum + project.myPending, 0);
  const totalApprovals = projects.reduce((sum, project) => sum + project.pendingApprovals, 0);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await apiFetch<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, code, description }),
      });
      toast.success("项目已创建，你已自动成为项目 PM");
      setOpen(false);
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="page-stack">
        <div className="page-header">
          <div>
            <div className="page-kicker">Workspace</div>
            <h1 className="page-title">{userName}的项目工作台</h1>
            <p className="page-sub">在项目范围内跟踪问题、维护责任组与排班，所有通知都只触达被配置的责任人。</p>
          </div>
          <div className="header-actions">
            {canCreateProject ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                <Plus size={15} /> 创建项目
              </button>
            ) : (
              <span className="badge badge-outline">项目创建仅限系统管理员</span>
            )}
          </div>
        </div>

        <div className="grid grid-4">
          <div className="card metric-card">
            <div className="metric-label"><FolderKanban size={15} /> 参与项目</div>
            <div className="metric-value">{projects.length}</div>
            <div className="metric-note">你仍是 {projects.length} 个项目中的成员</div>
          </div>
          <div className="card metric-card accent">
            <div className="metric-label"><Ticket size={15} /> 我的待处理</div>
            <div className="metric-value">{totalPending}</div>
            <div className="metric-note">跨项目统计，已定位/非问题/挂起不计入</div>
          </div>
          <div className="card metric-card">
            <div className="metric-label"><ShieldCheck size={15} /> 待我审批</div>
            <div className="metric-value">{totalApprovals}</div>
            <div className="metric-note">删除条码审核（仅项目 PM 处理）</div>
          </div>
          <div className="card metric-card">
            <div className="metric-label"><ClipboardList size={15} /> 处理原则</div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.55, marginTop: 11 }}>先解析排班，<br />再定位问题。</div>
            <div className="metric-note">状态不参与责任路由</div>
          </div>
        </div>

        <div className="section-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 className="section-title">项目列表</h2>
            <div className="section-sub">没有看到项目？请联系项目 PM 将你加入项目或责任组。</div>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-icon"><FolderKanban size={22} /></div>
            <h3>还没有参与任何项目</h3>
            <p>{canCreateProject ? "创建项目并由你担任 PM。" : "请联系系统管理员创建项目并将你加入项目。"}</p>
            {canCreateProject ? (
              <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setOpen(true)}>
                <Plus size={15} /> 创建第一个项目
              </button>
            ) : null}
          </div>
        ) : (
          <div className="groups-grid">
            {projects.map((project) => (
              <Link href={`/projects/${project.id}`} className="card group-card" key={project.id} style={{ color: "inherit" }}>
                <div style={{ height: 4, background: project.isPm ? "linear-gradient(90deg,#0f766e,#4cb9a9)" : "linear-gradient(90deg,#334155,#7c95aa)", borderRadius: "12px 12px 0 0" }} />
                <div className="group-card-top">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ color: "var(--muted)" }}>{project.code || "未设置项目编码"}</span>
                    <ArrowUpRight size={15} color="var(--muted-2)" />
                  </div>
                  <h3 style={{ marginTop: 8 }}>{project.name}</h3>
                  <p className="desc">{project.description || "暂无项目简介"}</p>
                  <div className="row" style={{ gap: 5, marginTop: 12 }}>
                    {project.isPm ? <span className="badge badge-teal">项目 PM</span> : null}
                    {project.isSupervisor ? <span className="badge badge-blue">项目主管</span> : null}
                    {!project.isPm && !project.isSupervisor ? <span className="badge badge-neutral">项目成员</span> : null}
                    {project.pendingApprovals > 0 ? <span className="badge badge-amber">待审核 {project.pendingApprovals}</span> : null}
                  </div>
                </div>
                <div className="group-card-metrics">
                  <div className="group-metric"><div className="n">{project.issueCount}</div><div className="l">问题总数</div></div>
                  <div className="group-metric"><div className="n">{project.groupCount}</div><div className="l">责任组</div></div>
                  <div className="group-metric"><div className="n">{project.memberCount}</div><div className="l">项目成员</div></div>
                </div>
                <div className="group-card-foot">
                  <span className="resolution"><b style={{ color: project.myPending > 0 ? "var(--primary)" : "var(--muted)" }}>{project.myPending}</b> 个待处理问题</span>
                  <span className="link-btn">进入项目 <ArrowUpRight size={13} /></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {open ? (
        <Modal
          title="创建新项目"
          description="创建后你将自动成为项目 PM，可新增责任组并配置负责人。"
          onClose={() => (pending ? null : setOpen(false))}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>取消</button>
              <button type="submit" form="create-project-form" className="btn btn-primary" disabled={pending}>{pending ? "创建中…" : "创建项目"}</button>
            </>
          }
        >
          <form id="create-project-form" onSubmit={createProject} className="form-grid">
            <div className="field full">
              <label>项目名称 <span className="required">*</span></label>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：星河服务器 NPI 验证" required maxLength={80} autoFocus />
            </div>
            <div className="field">
              <label>项目编码</label>
              <input className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="例如：XH-NPI-2026" maxLength={40} />
            </div>
            <div className="field full">
              <label>项目简介</label>
              <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简单描述项目范围或当前阶段" maxLength={500} />
            </div>
            {error ? <div className="alert alert-error full">{error}</div> : null}
          </form>
        </Modal>
      ) : null}
    </>
  );
}

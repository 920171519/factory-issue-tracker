import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  ListChecks,
  Network,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { getProject, getProjectAccess } from "@/lib/access";
import { getProjectHomeStats } from "@/lib/stats";
import { formatDateTime, formatShortDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ProjectHomePage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  const project = getProject(projectId);
  if (!access || !project) notFound();
  const stats = getProjectHomeStats(projectId, user.id);
  const maxStatus = Math.max(1, ...stats.statuses.map((status) => status.count));
  const maxGroup = Math.max(1, ...stats.groups.map((group) => group.total));
  const base = `/projects/${projectId}`;

  return (
    <div className="page-stack">
      <div className="hero-card">
        <div className="hero-content">
          <div className="page-kicker" style={{ color: "#7ad6c8" }}>{project.code || "INTERNAL PROJECT"}</div>
          <h2>{project.name}</h2>
          <p>{project.description || "该项目暂无简介。问题责任由录入时选择的参与责任组决定，并按当前班次排班自动解析处理人。"}</p>
          <div className="hero-chips">
            <span className="hero-chip">{access.isPm ? "项目 PM" : access.isSupervisor ? "项目主管" : access.isGroupLeader ? "责任组负责人" : "项目成员"}</span>
            <span className="hero-chip">问题 {stats.issueCount}</span>
            <span className="hero-chip">参与成员 {stats.memberCount}</span>
            <span className="hero-chip">责任组 {stats.groupCount}</span>
            {stats.pendingApprovals > 0 ? <span className="hero-chip" style={{ background: "rgba(255,153,82,.17)", color: "#ffd6b4", borderColor: "rgba(255,180,122,.24)" }}>待审核 {stats.pendingApprovals}</span> : null}
          </div>
        </div>
        <div style={{ position: "absolute", right: 28, bottom: 24, zIndex: 1, display: "flex", gap: 8 }}>
          <Link href={`${base}/communication`} className="btn btn-secondary" style={{ background: "rgba(255,255,255,.08)", color: "#e9f6f7", borderColor: "rgba(255,255,255,.18)" }}>
            <Network size={14} /> 查看排班
          </Link>
          <Link href={`${base}/issues?new=1`} className="btn btn-primary" style={{ background: "#f3fbf9", color: "#0b5e58" }}>
            <ClipboardCheck size={14} /> 录入问题
          </Link>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card metric-card">
          <div className="metric-label"><ListChecks size={15} /> 问题总数</div>
          <div className="metric-value">{stats.issueCount}</div>
          <div className="metric-note">按条码聚合展示 · {stats.pending} 个计入待处理</div>
        </div>
        <div className="card metric-card accent">
          <div className="metric-label"><ClipboardCheck size={15} /> 我的待处理</div>
          <div className="metric-value">{stats.myPending}</div>
          <div className="metric-note">我是主处理人且状态计入待处理</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><CircleDashed size={15} /> 当前未定位</div>
          <div className="metric-value">{stats.unlocated}</div>
          <div className="metric-note">计入待处理且未标记已定位</div>
        </div>
        <div className="card metric-card">
          <div className="metric-label"><ShieldCheck size={15} /> 删除审批</div>
          <div className="metric-value">{stats.pendingApprovals}</div>
          <div className="metric-note">
            {access.isPm ? <Link href={`${base}/approvals`} className="link-btn" style={{ marginTop: 2 }}>前往审批 <ArrowRight size={12} /></Link> : "仅项目 PM 可审批"}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="section-title">责任组问题分布</h2>
              <div className="section-sub">按参与责任组统计问题；同一问题可属于多个责任组。</div>
            </div>
            <Link href={`${base}/groups`} className="link-btn">管理责任组 <ArrowUpRight size={13} /></Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>责任组</th><th>成员</th><th>问题总数</th><th>未定位</th><th>已定位</th><th></th></tr></thead>
              <tbody>
                {stats.groups.length === 0 ? (
                  <tr><td colSpan={6}><div className="table-empty">尚未创建责任组。项目 PM 可先新增责任组并配置负责人。</div></td></tr>
                ) : stats.groups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="status-dot" style={{ background: group.enabled ? "var(--primary)" : "var(--muted-2)" }} />
                        <span className="main-cell">{group.name}</span>
                        {!group.enabled ? <span className="badge badge-neutral">停用</span> : null}
                      </div>
                      <div className="freq-bar" style={{ width: 110, marginTop: 6 }}><span style={{ width: `${Math.round((group.total / maxGroup) * 100)}%` }} /></div>
                    </td>
                    <td>{group.memberCount}</td>
                    <td className="mono">{group.total}</td>
                    <td><span style={{ color: group.unlocated > 0 ? "var(--warning)" : "var(--muted)" }}>{group.unlocated}</span></td>
                    <td><span style={{ color: group.identified > 0 ? "var(--success)" : "var(--muted)" }}>{group.identified}</span></td>
                    <td className="actions"><Link className="link-btn" href={`${base}/groups/${group.id}`}>查看 <ArrowRight size={12} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="section-title">状态分布</h2>
              <div className="section-sub">状态仅表示业务进展，不改变责任人。</div>
            </div>
            <Link href={`${base}/settings`} className="link-btn">状态配置</Link>
          </div>
          <div className="card-body">
            <div className="status-list">
              {stats.statuses.map((status) => (
                <div className="status-list-row" key={status.id}>
                  <div className="label"><span className="status-dot" style={{ background: status.color }} />{status.name}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(status.count / maxStatus) * 100}%`, background: status.color }} /></div>
                  <div className="status-count">{status.count}</div>
                </div>
              ))}
            </div>
            <div className="callout-strip" style={{ marginTop: 17 }}>
              <ShieldCheck size={15} />
              已定位、非问题、挂起不计入当前处理人的待处理数。
            </div>
          </div>
        </section>
      </div>

      <div className="home-bottom">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="section-title">问题分类分布</h2>
              <div className="section-sub">问题分类仅作为统计与筛选标签，不配置责任人。</div>
            </div>
            <Link href={`${base}/statistics`} className="link-btn">查看高频报错 <ArrowUpRight size={13} /></Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>问题分类</th><th>问题总数</th><th>未定位</th><th>已定位</th><th>待处理</th></tr></thead>
              <tbody>
                {stats.categories.length === 0 ? (
                  <tr><td colSpan={5}><div className="table-empty">暂无问题分类数据。</div></td></tr>
                ) : stats.categories.map((category) => (
                  <tr key={category.id}>
                    <td><span className="row" style={{ gap: 7 }}><span className="status-dot" style={{ background: category.color }} /><span className="main-cell">{category.name}</span></span></td>
                    <td className="mono">{category.total}</td>
                    <td>{category.unlocated}</td>
                    <td>{category.identified}</td>
                    <td>{category.pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="section-title">最近更新</h2>
              <div className="section-sub">快速回到最近变化的条码。</div>
            </div>
            <Link href={`${base}/issues`} className="link-btn">全部问题 <ArrowRight size={12} /></Link>
          </div>
          <div className="card-body" style={{ paddingTop: 6, paddingBottom: 10 }}>
            {stats.recent.length === 0 ? (
              <div className="empty-state" style={{ padding: "26px 10px" }}>
                <div className="empty-icon"><ClipboardCheck size={20} /></div>
                <h3>还没有问题记录</h3>
                <p>从右上角「录入问题」开始第一条跟踪。</p>
              </div>
            ) : (
              <div className="data-list">
                {stats.recent.map((item) => (
                  <Link key={item.id} href={`${base}/issues?barcode=${item.id}`} className="data-row" style={{ color: "inherit" }}>
                    <span className="avatar" style={{ width: 29, height: 29, borderRadius: 8 }}>
                      {item.priority === "HIGH" ? <TriangleAlert size={13} /> : <ClipboardCheck size={13} />}
                    </span>
                    <div className="grow">
                      <div className="title mono" style={{ fontSize: 12 }}>{item.barcode}</div>
                      <div className="meta">{item.locationNo} · {item.groupNames.join(" / ") || "无责任组"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        {item.statusNames.slice(0, 2).map((name) => <span key={name} className="badge badge-outline">{name}</span>)}
                      </div>
                      <div className="mini-meta" style={{ marginTop: 4 }}>{formatShortDateTime(item.updatedAt)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="project-meta-strip">
        <span>项目创建于 {formatDateTime(project.created_at, { dateOnly: true })}</span>
        <span className="dot" />
        <span>最近更新 {formatDateTime(stats.recent[0]?.updatedAt || project.updated_at)}</span>
        <span className="dot" />
        <span>已识别 {stats.identified} 个问题</span>
        {access.isPm || access.isSupervisor ? <><span className="dot" /><span>项目主管可见全量信息</span></> : null}
        <span className="spacer" />
        <span className="row" style={{ gap: 5 }}><UsersRound size={12} /> 当前参与人数 {stats.memberCount}</span>
        <span className="row" style={{ gap: 5 }}><CircleCheck size={12} /> 已定位 {stats.identified}</span>
      </div>
    </div>
  );
}
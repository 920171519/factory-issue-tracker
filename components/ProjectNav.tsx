"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ListChecks,
  UsersRound,
  Network,
  ChartNoAxesColumnIncreasing,
  ShieldCheck,
  Settings2,
  ContactRound,
  ServerCog,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

interface ProjectNavProps {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  isPm: boolean;
  isSupervisor: boolean;
  isGroupLeader: boolean;
  pendingApprovals: number;
}

export function ProjectNav({ projectId, projectName, projectCode, isPm, isSupervisor, isGroupLeader, pendingApprovals }: ProjectNavProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem("fit:sidebar-collapsed") === "1");
  }, []);
  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("fit:sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }
  const base = `/projects/${projectId}`;
  const items = [
    { href: base, label: "项目概览", icon: LayoutDashboard, exact: true },
    { href: `${base}/issues`, label: "问题跟踪", icon: ListChecks },
    { href: `${base}/communication`, label: "沟通地图", icon: Network },
    { href: `${base}/statistics`, label: "高频报错", icon: ChartNoAxesColumnIncreasing },
    ...(isPm || isSupervisor ? [{ href: `${base}/approvals`, label: "删除审批", icon: ShieldCheck, count: pendingApprovals }] : []),
  ];
  const adminItems = [
    { href: `${base}/groups`, label: "责任组", icon: UsersRound },
    ...(isPm || isSupervisor ? [{ href: `${base}/members`, label: "项目成员", icon: ContactRound }] : []),
    ...(isPm || isSupervisor ? [{ href: `${base}/settings`, label: "项目配置", icon: Settings2 }] : []),
    { href: `${base}/info`, label: "基础信息", icon: ServerCog },
  ];
  const active = (href: string, exact?: boolean) => exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <aside className={`project-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-collapse-row">
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          <span>收起</span>
        </button>
      </div>
      <div className="sidebar-project">
        <div className="project-code">{projectCode || "INTERNAL PROJECT"}</div>
        <h2>{projectName}</h2>
        <div className="project-role">
          {isPm ? <span>项目 PM</span> : null}
          {isSupervisor ? <span>项目主管</span> : null}
          {isGroupLeader ? <span>责任组负责人</span> : null}
          {!isPm && !isSupervisor && !isGroupLeader ? <span>项目成员</span> : null}
        </div>
      </div>
      <div className="sidebar-label">工作台</div>
      <nav className="project-nav">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={active(item.href, "exact" in item ? item.exact : false) ? "active" : ""} title={collapsed ? item.label : undefined}>
              <Icon size={15} />
              <span>{item.label}</span>
              {"count" in item && item.count ? <span className="nav-count alert">{item.count}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-label">组织与配置</div>
      <nav className="project-nav">
        {adminItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={active(item.href) ? "active" : ""} title={collapsed ? item.label : undefined}>
              <Icon size={15} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <b>责任路由规则</b><br />
        问题按参与责任组与当前班次排班解析处理人，状态变化不改变责任人。
      </div>
    </aside>
  );
}

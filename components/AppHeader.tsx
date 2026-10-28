"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, ClipboardCheck, FolderKanban, LogOut, ShieldCheck } from "lucide-react";

interface AppHeaderProps {
  user: { id: string; name: string; employeeNo: string; isSystemAdmin: boolean };
  unread: number;
}

export function AppHeader({ user, unread }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const initial = user.name.slice(0, 1);
  return (
    <header className="app-topbar">
      <div className="app-topbar-inner">
        <Link className="brand" href="/projects">
          <span className="brand-mark"><ClipboardCheck size={18} /></span>
          <span>
            <span className="brand-name">定位台</span>
            <span className="brand-sub">ISSUE TRACKER</span>
          </span>
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link href="/projects" className={pathname === "/projects" || pathname.startsWith("/projects/") ? "active" : ""}>
            <FolderKanban size={15} /> 项目
          </Link>
          <Link href="/notifications" className={pathname === "/notifications" ? "active" : ""}>
            <Bell size={15} /> 通知
          </Link>
        </nav>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <Link href="/notifications" className="bell-btn" aria-label="查看通知">
            <Bell size={17} />
            {unread > 0 ? <span className="bell-dot">{unread > 99 ? "99+" : unread}</span> : null}
          </Link>
          <div className="user-chip user-menu-wrap" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              style={{ display: "flex", alignItems: "center", gap: 9, border: 0, background: "transparent", padding: 0 }}
              aria-expanded={menuOpen}
            >
              <span className="avatar">{initial}</span>
              <span className="user-meta">
                <strong>{user.name}</strong>
                <span>{user.employeeNo}{user.isSystemAdmin ? " · 系统管理员" : ""}</span>
              </span>
              <ChevronDown size={14} color="var(--muted)" />
            </button>
            {menuOpen ? (
              <div className="user-menu">
                <div style={{ padding: "7px 10px 9px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                  <div className="small" style={{ fontWeight: 600 }}>{user.name}</div>
                  <div className="hint">工号 {user.employeeNo}</div>
                </div>
                <Link href="/projects" onClick={() => setMenuOpen(false)}><FolderKanban size={14} /> 我的项目</Link>
                <Link href="/notifications" onClick={() => setMenuOpen(false)}><Bell size={14} /> 通知中心 {unread > 0 ? `（${unread}）` : ""}</Link>
                <div style={{ padding: "4px 10px", color: "var(--muted-2)", fontSize: 10, display: "flex", alignItems: "center", gap: 5 }}>
                  <ShieldCheck size={12} /> 内部系统 · 按权限访问
                </div>
                <button type="button" className="danger" onClick={() => void logout()} disabled={loggingOut}>
                  <LogOut size={14} /> {loggingOut ? "退出中…" : "退出登录"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

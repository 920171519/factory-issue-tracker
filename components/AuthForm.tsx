"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { apiFetch, errorMessage } from "@/lib/client-api";

interface AuthFormProps {
  mode: "login" | "register";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const isLogin = mode === "login";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!isLogin && !/^[a-z]\d{8}$/.test(employeeNo.trim())) {
      setError("工号格式必须为 1 个小写字母 + 8 个数字，例如 a00000001");
      return;
    }
    setPending(true);
    try {
      await apiFetch(isLogin ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        body: JSON.stringify(isLogin ? { employeeNo, password } : { name, employeeNo, password }),
      });
      router.push("/projects");
      router.refresh();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-form-box">
      <div className="mobile-brand">
        <Link className="brand" href="/login">
          <span className="brand-mark">定</span>
          <span><span className="brand-name">定位台</span><span className="brand-sub">ISSUE TRACKER</span></span>
        </Link>
      </div>
      <div className="page-kicker">{isLogin ? "Welcome back" : "Create your account"}</div>
      <h2>{isLogin ? "登录工作台" : "注册新账号"}</h2>
      <p className="sub">{isLogin ? "使用工号登录，进入你所参与的项目。" : "注册后即可由项目 PM 将你加入项目或责任组。"}</p>
      <form className="auth-form" onSubmit={submit}>
        {!isLogin ? (
          <div className="field">
            <label htmlFor="name">姓名</label>
            <input id="name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入真实姓名" autoComplete="name" required maxLength={30} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="employeeNo">工号</label>
          <input
            id="employeeNo"
            className="input"
            value={employeeNo}
            onChange={(event) => setEmployeeNo(event.target.value)}
            placeholder={isLogin ? "请输入工号" : "例如 a00000001"}
            autoComplete="username"
            required
            maxLength={9}
          />
          {!isLogin ? <div className="field-hint">工号为 1 个小写字母加 8 个数字。</div> : null}
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              className="input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isLogin ? "请输入密码" : "至少 6 位密码"}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={6}
              style={{ paddingRight: 38 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((show) => !show)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: 0, background: "none", color: "var(--muted)", display: "grid", placeItems: "center" }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={pending}>
          {pending ? <LoaderCircle size={16} className="spin" /> : null}
          {pending ? (isLogin ? "登录中…" : "创建中…") : isLogin ? "进入工作台" : "注册并进入"}
          {!pending ? <ArrowRight size={16} /> : null}
        </button>
      </form>
      <div className="auth-switch">
        {isLogin ? "还没有账号？" : "已有账号？"}{" "}
        <Link href={isLogin ? "/register" : "/login"}>{isLogin ? "注册新账号" : "返回登录"}</Link>
      </div>
      <div className="auth-hint">
        本系统为内部协作工具。账号权限按项目与责任组隔离；未参与项目时无法查看项目内容。<br />
        演示环境初始化账号见 <code>README.md</code> 或部署文档。
      </div>
    </div>
  );
}

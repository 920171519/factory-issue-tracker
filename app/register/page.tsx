import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { getPageUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage() {
  const user = await getPageUser();
  if (user) redirect("/projects");
  return (
    <div className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand-inner">
          <Link className="brand" href="/login">
            <span className="brand-mark"><ClipboardCheck size={20} /></span>
            <span><span className="brand-name">定位台</span><span className="brand-sub">FACTORY ISSUE INTELLIGENCE</span></span>
          </Link>
          <div className="auth-hero">
            <div className="eyebrow">Responsibility-driven issue tracking</div>
            <h1>让每一个问题<br />落到正确的人。</h1>
            <p>围绕责任组排班驱动问题定位协作。录入、转接、状态与通知，都以当前班次的配置责任人为准。</p>
            <div className="auth-points">
              <div className="auth-point"><span className="num">01</span><span>按星期与时间段自动解析责任组处理人，跨班自动交接。</span></div>
              <div className="auth-point"><span className="num">02</span><span>组内转交只在本组内进行，跨组转接只选择目标责任组，不越过组织边界。</span></div>
              <div className="auth-point"><span className="num">03</span><span>状态只描述业务进展，责任路径完整留痕、可追溯。</span></div>
              <div className="auth-point"><span className="num">04</span><span>项目级权限隔离，PM、主管、组负责人与成员各司其职。</span></div>
            </div>
          </div>
          <div className="auth-footer">
            <span>定位台 · 内部问题协作</span>
            <span>Role-based Responsibility Routing</span>
          </div>
        </div>
      </section>
      <section className="auth-form-panel">
        <AuthForm mode="register" />
      </section>
    </div>
  );
}
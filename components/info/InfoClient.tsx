"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  MapPin,
  Package,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import type { HostView } from "@/lib/taxonomy";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface InfoClientProps {
  projectId: string;
  hosts: HostView[];
  packageCount: number;
  isPm: boolean;
}

export function InfoClient({ projectId, hosts, packageCount, isPm }: InfoClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await task();
      router.refresh();
    } catch (actionError) {
      setError(errorMessage(actionError));
      toast.error(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Project Foundations</div>
          <h1 className="page-title">基础信息</h1>
          <p className="page-sub">维护库位云主机映射。软件包编码清单与转测试/验证/转正流程已迁移到「软件包管理」页面统一维护。</p>
        </div>
        {!isPm ? <div className="header-actions"><span className="badge badge-blue">项目成员 · 只读</span></div> : null}
      </div>

      <div className="grid grid-2">
        <div className="card metric-card"><div className="metric-label"><Server size={15} /> 已维护库位</div><div className="metric-value">{hosts.length}</div><div className="metric-note">库位号到云主机 IP、账号、密码的映射</div></div>
        <div className="card metric-card">
          <div className="metric-label"><Package size={15} /> 软件包</div>
          <div className="metric-value">{packageCount}</div>
          <div className="metric-note">
            <Link className="link" href={`/projects/${projectId}/packages`}>打开软件包管理 <ArrowRight size={11} /></Link>
          </div>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card">
        <div className="card-header">
          <div><h2 className="section-title">库位 → 云主机</h2><div className="section-sub">录入问题时会按库位号自动识别云主机并保存快照。密码仅项目内成员可见，请妥善管理访问权限。</div></div>
          <span className="badge badge-outline">{hosts.length} 个库位</span>
        </div>
        <div className="table-wrap">
          <table className="table config-table">
            <thead><tr><th>库位号</th><th>云主机 IP</th><th>账号</th><th>密码</th><th>更新时间</th>{isPm ? <th></th> : null}</tr></thead>
            <tbody>
              {hosts.length === 0 ? <tr><td colSpan={isPm ? 6 : 5}><div className="table-empty">暂无云主机映射。</div></td></tr> : hosts.map((host) => (
                <tr key={`${host.id}-${host.hostIp}-${host.hostAccount}-${host.hostPassword}`}>
                  <td className="main-cell mono"><MapPin size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{host.locationNo}</td>
                  <td className="mono">{host.hostIp}</td>
                  <td className="mono">{host.hostAccount || "—"}</td>
                  <td>
                    {host.hostPassword ? (
                      <span className="row" style={{ gap: 5 }}>
                        <span className="mono">{revealed.has(host.id) ? host.hostPassword : "••••••••"}</span>
                        <button type="button" className="reveal-btn" onClick={() => setRevealed((current) => { const next = new Set(current); if (next.has(host.id)) next.delete(host.id); else next.add(host.id); return next; })}>
                          {revealed.has(host.id) ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                      </span>
                    ) : <span className="hint">未填写</span>}
                  </td>
                  <td className="mini-meta">{formatDateTime(host.updatedAt)}</td>
                  {isPm ? (
                    <td className="actions">
                      <button type="button" className="icon-btn danger" disabled={busy !== null} onClick={async () => {
                        if (!window.confirm(`确定删除库位「${host.locationNo}」的云主机映射吗？`)) return;
                        await run(`delete-host-${host.id}`, async () => {
                          await apiFetch(`/api/projects/${projectId}/hosts/${host.id}`, { method: "DELETE" });
                          toast.success("云主机映射已删除");
                        });
                      }}><Trash2 size={13} /></button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isPm ? <AddHostForm projectId={projectId} busy={busy} run={run} /> : null}
      </div>

      <div className="callout-strip">
        <Package size={14} /> 软件包编码、责任组归属、正式/验证/测试版本以及转测试与转验证批次，统一在
        <Link className="link" href={`/projects/${projectId}/packages`} style={{ marginLeft: 4 }}>软件包管理</Link>
        维护。
      </div>

      <div className="callout-strip">
        <KeyRound size={14} /> 设备测试接口当前为桩实现。录入弹窗中可点击「从设备接口读取」，自动获得模拟条码和设备 IP；接入真实 MES 时替换对应接口即可。
      </div>
    </div>
  );
}

function AddHostForm({ projectId, busy, run }: {
  projectId: string; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [locationNo, setLocationNo] = useState("");
  const [hostIp, setHostIp] = useState("");
  const [hostAccount, setHostAccount] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run("save-host", async () => {
      await apiFetch(`/api/projects/${projectId}/hosts`, {
        method: "POST",
        body: JSON.stringify({ locationNo, hostIp, hostAccount, hostPassword }),
      });
      setLocationNo("");
      setHostIp("");
      setHostAccount("");
      setHostPassword("");
      toast.success("库位云主机映射已保存");
    });
  }
  return (
    <form onSubmit={submit} className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="panel-title">新增 / 覆盖库位云主机映射</div>
      <div className="inline-form">
        <div className="field" style={{ maxWidth: 150 }}><label>库位号</label><input className="input mono" value={locationNo} onChange={(event) => setLocationNo(event.target.value)} required maxLength={50} placeholder="A-01" /></div>
        <div className="field" style={{ maxWidth: 180 }}><label>云主机 IP</label><input className="input mono" value={hostIp} onChange={(event) => setHostIp(event.target.value)} required maxLength={100} placeholder="192.168.1.10" /></div>
        <div className="field" style={{ maxWidth: 160 }}><label>账号</label><input className="input" value={hostAccount} onChange={(event) => setHostAccount(event.target.value)} maxLength={100} /></div>
        <div className="field" style={{ maxWidth: 160 }}><label>密码</label><input className="input" type="password" value={hostPassword} onChange={(event) => setHostPassword(event.target.value)} maxLength={200} /></div>
        <button className="btn btn-primary" type="submit" disabled={busy !== null}><Plus size={14} /> 保存映射</button>
      </div>
      <div className="field-hint" style={{ marginTop: 6 }}>同一库位再次保存会更新原映射。已录入条码会保留录入时的云主机快照。</div>
    </form>
  );
}

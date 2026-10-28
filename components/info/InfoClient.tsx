"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Check,
  CloudCog,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MapPin,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import type { CodeView, HostView } from "@/lib/taxonomy";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/time";

interface InfoClientProps {
  projectId: string;
  codes: CodeView[];
  hosts: HostView[];
  memberOptions: { id: string; name: string; employeeNo: string }[];
  isPm: boolean;
}

export function InfoClient({ projectId, codes, hosts, memberOptions, isPm }: InfoClientProps) {
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
          <p className="page-sub">维护编码清单与库位云主机映射。录入问题时按库位号自动带出云主机信息，设备当前条码可先由接口桩读取。</p>
        </div>
        {!isPm ? <div className="header-actions"><span className="badge badge-blue">项目成员 · 只读</span></div> : null}
      </div>

      <div className="grid grid-2">
        <div className="card metric-card"><div className="metric-label"><Server size={15} /> 已维护库位</div><div className="metric-value">{hosts.length}</div><div className="metric-note">库位号到云主机 IP、账号、密码的映射</div></div>
        <div className="card metric-card"><div className="metric-label"><CloudCog size={15} /> 编码条目</div><div className="metric-value">{codes.length}</div><div className="metric-note">编码、描述、版本与责任人清单</div></div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card">
        <div className="card-header">
          <div><h2 className="section-title">编码清单</h2><div className="section-sub">按编码维护描述、版本和责任人。责任人可留空。</div></div>
          <span className="badge badge-outline">{codes.length} 条</span>
        </div>
        <div className="table-wrap">
          <table className="table config-table">
            <thead><tr><th>编码</th><th>描述</th><th>版本</th><th>责任人</th><th>更新时间</th>{isPm ? <th></th> : null}</tr></thead>
            <tbody>
              {codes.length === 0 ? <tr><td colSpan={isPm ? 6 : 5}><div className="table-empty">暂无编码清单。{isPm ? "在下方新增编码。" : ""}</div></td></tr> : codes.map((code) => (
                <CodeRow key={`${code.id}-${code.code}-${code.description}-${code.version}-${code.ownerId}`} projectId={projectId} code={code} memberOptions={memberOptions} isPm={isPm} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>
        {isPm ? <AddCodeForm projectId={projectId} memberOptions={memberOptions} busy={busy} run={run} /> : null}
      </div>

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
        <KeyRound size={14} /> 设备测试接口当前为桩实现。录入弹窗中可点击「从设备接口读取」，自动获得模拟条码和设备 IP；接入真实 MES 时替换对应接口即可。
      </div>
    </div>
  );
}

function CodeRow({ projectId, code, memberOptions, isPm, busy, run }: {
  projectId: string; code: CodeView; memberOptions: { id: string; name: string; employeeNo: string }[]; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [value, setValue] = useState(code.code);
  const [description, setDescription] = useState(code.description || "");
  const [version, setVersion] = useState(code.version || "");
  const [ownerId, setOwnerId] = useState(code.ownerId || "");
  return (
    <tr>
      <td><input className="input mono" value={value} onChange={(event) => setValue(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input" value={version} onChange={(event) => setVersion(event.target.value)} disabled={!isPm} style={{ minWidth: 80 }} /></td>
      <td>
        {isPm ? (
          <select className="select code-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">未指定</option>
            {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        ) : (code.ownerName || "—")}
      </td>
      <td className="mini-meta">{formatDateTime(code.updatedAt)}</td>
      {isPm ? (
        <td className="actions"><div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void run(`save-code-${code.id}`, async () => {
            await apiFetch(`/api/projects/${projectId}/codes/${code.id}`, { method: "PATCH", body: JSON.stringify({ code: value, description, version, ownerId: ownerId || null }) });
            toast.success("编码已保存");
          })}><Check size={12} /> 保存</button>
          <button type="button" className="icon-btn danger" disabled={busy !== null} onClick={async () => {
            if (!window.confirm(`确定删除编码「${code.code}」吗？`)) return;
            await run(`delete-code-${code.id}`, async () => {
              await apiFetch(`/api/projects/${projectId}/codes/${code.id}`, { method: "DELETE" });
              toast.success("编码已删除");
            });
          }}><Trash2 size={13} /></button>
        </div></td>
      ) : null}
    </tr>
  );
}

function AddCodeForm({ projectId, memberOptions, busy, run }: {
  projectId: string; memberOptions: { id: string; name: string; employeeNo: string }[]; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");
  const [ownerId, setOwnerId] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run("add-code", async () => {
      await apiFetch(`/api/projects/${projectId}/codes`, { method: "POST", body: JSON.stringify({ code, description, version, ownerId: ownerId || null }) });
      setCode("");
      setDescription("");
      setVersion("");
      toast.success("编码已添加");
    });
  }
  return (
    <form onSubmit={submit} className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="panel-title">新增编码</div>
      <div className="inline-form">
        <div className="field" style={{ maxWidth: 170 }}><label>编码</label><input className="input mono" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={80} /></div>
        <div className="field"><label>描述</label><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} /></div>
        <div className="field" style={{ maxWidth: 110 }}><label>版本</label><input className="input" value={version} onChange={(event) => setVersion(event.target.value)} maxLength={50} /></div>
        <div className="field" style={{ maxWidth: 150 }}><label>责任人</label><select className="select" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">未指定</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
        <button className="btn btn-primary" type="submit" disabled={busy !== null}><Plus size={14} /> 新增</button>
      </div>
    </form>
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

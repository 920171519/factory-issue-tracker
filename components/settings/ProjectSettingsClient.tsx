"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BellRing,
  CalendarDays,
  Check,
  Clock3,
  FolderCog,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
} from "lucide-react";
import type { ProjectRow } from "@/lib/access";
import type { CategoryView, CodeView, HolidayView, StatusView } from "@/lib/taxonomy";
import { apiFetch, errorMessage } from "@/lib/client-api";
import { useToast } from "@/components/Toast";

interface TimeSlotView {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  timeLabel: string;
  scheduleCount: number;
}

interface ProjectSettingsClientProps {
  project: ProjectRow;
  projectId: string;
  categories: CategoryView[];
  statuses: StatusView[];
  timeSlots: TimeSlotView[];
  groups: { id: string; name: string; enabled: number }[];
  defaultGroupIds: string[];
  holidays: HolidayView[];
  isPm: boolean;
}

type Tab = "general" | "categories" | "statuses" | "slots" | "defaults" | "holidays";

const minutesString = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function ProjectSettingsClient({
  project,
  projectId,
  categories,
  statuses,
  timeSlots,
  groups,
  defaultGroupIds,
  holidays,
  isPm,
}: ProjectSettingsClientProps) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("general");
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code || "");
  const [description, setDescription] = useState(project.description || "");
  const [notifySelf, setNotifySelf] = useState(project.notify_self_on_status === 1);
  const [busy, setBusy] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState("");
  const [selectedDefaults, setSelectedDefaults] = useState<string[]>(defaultGroupIds);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveGeneral(event: React.FormEvent) {
    event.preventDefault();
    setGeneralError("");
    setBusy("general");
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, code, description, notifySelfOnStatus: notifySelf }),
      });
      toast.success("项目设置已保存");
      router.refresh();
    } catch (error) {
      setGeneralError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function toggleDefault(id: string) {
    setSelectedDefaults((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const tabs: { id: Tab; label: string; icon: typeof Settings2 }[] = [
    { id: "general", label: "基本设置", icon: Settings2 },
    { id: "categories", label: "问题分类", icon: Tags },
    { id: "statuses", label: "问题状态", icon: FolderCog },
    { id: "slots", label: "班次模板", icon: Clock3 },
    { id: "defaults", label: "默认责任组", icon: ShieldCheck },
    { id: "holidays", label: "节假日", icon: CalendarDays },
  ];

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Project Configuration</div>
          <h1 className="page-title">项目配置</h1>
          <p className="page-sub">配置问题分类、业务状态、项目班次模板与默认责任组。责任组的具体成员与排班由组负责人维护。</p>
        </div>
        {!isPm ? <div className="header-actions"><span className="badge badge-blue">项目主管 · 只读</span></div> : null}
      </div>
      {!isPm ? <div className="callout-strip"><ShieldCheck size={14} /> 项目主管可查看全部配置；仅项目 PM 可修改这些设置。</div> : null}

      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon size={14} /> {item.label}</button>;
          })}
        </nav>

        <div className="settings-section">
          {tab === "general" ? (
            <form className="card" onSubmit={saveGeneral}>
              <div className="card-header"><div><h2 className="section-title">基本设置</h2><div className="section-sub">项目名称、编码和状态通知偏好。</div></div></div>
              <div className="card-body">
                <div className="form-grid">
                  <div className="field full"><label>项目名称 <span className="required">*</span></label><input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!isPm} required maxLength={80} /></div>
                  <div className="field"><label>项目编码</label><input className="input" value={code} onChange={(event) => setCode(event.target.value)} disabled={!isPm} maxLength={40} /></div>
                  <div className="field full"><label>项目简介</label><textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} disabled={!isPm} maxLength={500} /></div>
                </div>
                <div style={{ marginTop: 17 }}>
                  <div className="toggle-row">
                    <div><div className="title">状态更新时通知当前处理人本人</div><div className="desc">关闭后，若操作人就是当前处理人，将不再给自己发送状态更新通知，仅记录操作。</div></div>
                    <label className="switch"><input type="checkbox" checked={notifySelf} onChange={(event) => setNotifySelf(event.target.checked)} disabled={!isPm} /><span /></label>
                  </div>
                </div>
                {generalError ? <div className="alert alert-error" style={{ marginTop: 12 }}>{generalError}</div> : null}
              </div>
              {isPm ? <div className="card-foot" style={{ textAlign: "right" }}><button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === "general" ? "保存中…" : "保存设置"}</button></div> : null}
            </form>
          ) : null}

          {tab === "categories" ? (
            <CategorySection projectId={projectId} categories={categories} isPm={isPm} busy={busy} run={run} />
          ) : null}
          {tab === "statuses" ? (
            <StatusSection projectId={projectId} statuses={statuses} isPm={isPm} busy={busy} run={run} />
          ) : null}
          {tab === "slots" ? (
            <TimeSlotSection projectId={projectId} timeSlots={timeSlots} isPm={isPm} busy={busy} run={run} />
          ) : null}

          {tab === "defaults" ? (
            <div className="card">
              <div className="card-header"><div><h2 className="section-title">项目默认责任组</h2><div className="section-sub">录入问题时默认选中这些责任组，录入人仍可修改。未选择责任组且没有默认组时，系统会提示先选择责任组。</div></div></div>
              <div className="card-body">
                {groups.length === 0 ? <div className="alert alert-warning">当前项目暂无责任组，请先在「责任组」中创建。</div> : (
                  <div className="default-groups-grid">
                    {groups.map((group) => (
                      <label className={`choice ${selectedDefaults.includes(group.id) ? "selected" : ""}`} key={group.id}>
                        <input type="checkbox" checked={selectedDefaults.includes(group.id)} onChange={() => toggleDefault(group.id)} disabled={!isPm || group.enabled === 0} />
                        <span><strong>{group.name}</strong><small>{group.enabled ? "启用中" : "已停用（不可设为默认）"}</small></span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="field-hint" style={{ marginTop: 8 }}>可配置一个或多个默认责任组。默认组仅在录入人为空选择时使用；已分配的当前处理人不会因修改默认组而变化。</div>
              </div>
              {isPm ? (
                <div className="card-foot" style={{ textAlign: "right" }}>
                  <button type="button" className="btn btn-primary" disabled={busy !== null || groups.length === 0} onClick={() => void run("defaults", async () => {
                    await apiFetch(`/api/projects/${projectId}/default-groups`, { method: "PUT", body: JSON.stringify({ groupIds: selectedDefaults }) });
                    toast.success("默认责任组已保存");
                  })}>{busy === "defaults" ? "保存中…" : "保存默认组"}</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "holidays" ? (
            <HolidaySection projectId={projectId} holidays={holidays} isPm={isPm} busy={busy} run={run} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CategorySection({ projectId, categories, isPm, busy, run }: {
  projectId: string; categories: CategoryView[]; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0f766e");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await run("add-category", async () => {
      await apiFetch(`/api/projects/${projectId}/categories`, { method: "POST", body: JSON.stringify({ name, color }) });
      setName("");
      toast.success("问题分类已新增");
    });
  }

  return (
    <div className="stack-sm">
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">问题分类</h2><div className="section-sub">分类是可选统计标签，不绑定责任组、不配置责任人，不作为责任路由依据。</div></div></div>
        <div className="table-wrap">
          <table className="table config-table">
            <thead><tr><th>分类名称</th><th>颜色</th><th>使用条码数</th><th></th></tr></thead>
            <tbody>
              {categories.length === 0 ? <tr><td colSpan={4}><div className="table-empty">暂无问题分类。</div></td></tr> : categories.map((category) => (
                <CategoryRow key={`${category.id}-${category.name}-${category.color}`} projectId={projectId} category={category} isPm={isPm} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {isPm ? (
        <form className="card card-pad" onSubmit={add}>
          <div className="panel-title">新增问题分类</div>
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 260 }}><label>名称</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：电源异常" required maxLength={40} /></div>
            <div className="field" style={{ maxWidth: 100 }}><label>颜色</label><input className="input color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></div>
            <button className="btn btn-secondary" type="submit" disabled={busy !== null}><Plus size={14} /> 新增分类</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function CategoryRow({ projectId, category, isPm, busy, run }: {
  projectId: string; category: CategoryView; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  return (
    <tr>
      <td><input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={!isPm} /></td>
      <td className="mono">{category.issueCount}</td>
      <td className="actions">
        {isPm ? <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void run(`save-category-${category.id}`, async () => {
            await apiFetch(`/api/projects/${projectId}/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name, color }) });
            toast.success("分类已保存");
          })}><Check size={12} /> 保存</button>
          <button type="button" className="icon-btn danger" disabled={busy !== null || category.issueCount > 0} title={category.issueCount > 0 ? "已有问题使用，不能删除" : "删除"} onClick={async () => {
            if (!window.confirm(`确定删除分类「${category.name}」吗？`)) return;
            await run(`delete-category-${category.id}`, async () => {
              await apiFetch(`/api/projects/${projectId}/categories/${category.id}`, { method: "DELETE" });
              toast.success("分类已删除");
            });
          }}><Trash2 size={13} /></button>
        </div> : <span className="hint">只读</span>}
      </td>
    </tr>
  );
}

function StatusSection({ projectId, statuses, isPm, busy, run }: {
  projectId: string; statuses: StatusView[]; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [countsPending, setCountsPending] = useState(true);
  const [requiresReason, setRequiresReason] = useState(false);
  const [isIdentified, setIsIdentified] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await run("add-status", async () => {
      await apiFetch(`/api/projects/${projectId}/statuses`, {
        method: "POST",
        body: JSON.stringify({ name, color, countsPending, requiresReason, isIdentified, isDefault }),
      });
      setName("");
      setCountsPending(true);
      setRequiresReason(false);
      setIsIdentified(false);
      setIsDefault(false);
      toast.success("问题状态已新增；新增状态无需配置责任人");
    });
  }

  return (
    <div className="stack-sm">
      <div className="callout-strip">状态仅代表业务进展，状态间不设流转限制。已定位、非问题、挂起默认不计入待处理数；状态变化不会改变参与责任组和责任人。</div>
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">问题状态</h2><div className="section-sub">系统默认提供的状态可在项目内维护；建议保留默认状态「定位中」。</div></div></div>
        <div className="table-wrap">
          <table className="table config-table">
            <thead><tr><th>名称</th><th>颜色</th><th>计入待处理</th><th>需填原因</th><th>已定位</th><th>默认状态</th><th>问题数</th><th></th></tr></thead>
            <tbody>
              {statuses.map((status) => (
                <StatusRow key={`${status.id}-${status.name}-${status.color}-${status.countsPending}-${status.requiresReason}-${status.isIdentified}-${status.isDefault}`} projectId={projectId} status={status} isPm={isPm} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {isPm ? (
        <form className="card card-pad" onSubmit={add}>
          <div className="panel-title">新增问题状态</div>
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 180 }}><label>状态名称</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={30} placeholder="例如：待复检" /></div>
            <div className="field" style={{ maxWidth: 90 }}><label>颜色</label><input className="input color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></div>
            <label className="checkbox-line"><input type="checkbox" checked={countsPending} onChange={(event) => setCountsPending(event.target.checked)} /> 计入待处理</label>
            <label className="checkbox-line"><input type="checkbox" checked={requiresReason} onChange={(event) => setRequiresReason(event.target.checked)} /> 必须填写原因</label>
            <label className="checkbox-line"><input type="checkbox" checked={isIdentified} onChange={(event) => setIsIdentified(event.target.checked)} /> 标记已定位</label>
            <label className="checkbox-line"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> 设为默认</label>
            <button className="btn btn-secondary" type="submit" disabled={busy !== null}><Plus size={14} /> 新增状态</button>
          </div>
          <div className="field-hint" style={{ marginTop: 6 }}>新增状态不需要配置责任人或排班，也不会影响现有问题责任人。</div>
        </form>
      ) : null}
    </div>
  );
}

function StatusRow({ projectId, status, isPm, busy, run }: {
  projectId: string; status: StatusView; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  const [countsPending, setCountsPending] = useState(status.countsPending);
  const [requiresReason, setRequiresReason] = useState(status.requiresReason);
  const [isIdentified, setIsIdentified] = useState(status.isIdentified);
  const [isDefault, setIsDefault] = useState(status.isDefault);
  return (
    <tr>
      <td><input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input color-input" type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={!isPm} /></td>
      <td><input type="checkbox" checked={countsPending} onChange={(event) => setCountsPending(event.target.checked)} disabled={!isPm} /></td>
      <td><input type="checkbox" checked={requiresReason} onChange={(event) => setRequiresReason(event.target.checked)} disabled={!isPm} /></td>
      <td><input type="checkbox" checked={isIdentified} onChange={(event) => setIsIdentified(event.target.checked)} disabled={!isPm} /></td>
      <td><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} disabled={!isPm || status.isDefault} title={status.isDefault ? "当前默认状态；如需更换，请将其他状态设为默认" : ""} /></td>
      <td className="mono">{status.issueCount}</td>
      <td className="actions">
        {isPm ? <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void run(`save-status-${status.id}`, async () => {
            await apiFetch(`/api/projects/${projectId}/statuses/${status.id}`, {
              method: "PATCH",
              body: JSON.stringify({ name, color, countsPending, requiresReason, isIdentified, isDefault }),
            });
            toast.success("状态已保存");
          })}><Check size={12} /> 保存</button>
          <button type="button" className="icon-btn danger" disabled={busy !== null || status.isDefault || status.issueCount > 0} title={status.isDefault ? "默认状态不可删除" : status.issueCount > 0 ? "已有问题使用，不能删除" : "删除"} onClick={async () => {
            if (!window.confirm(`确定删除状态「${status.name}」吗？`)) return;
            await run(`delete-status-${status.id}`, async () => {
              await apiFetch(`/api/projects/${projectId}/statuses/${status.id}`, { method: "DELETE" });
              toast.success("状态已删除");
            });
          }}><Trash2 size={13} /></button>
        </div> : <span className="hint">只读</span>}
      </td>
    </tr>
  );
}

function TimeSlotSection({ projectId, timeSlots, isPm, busy, run }: {
  projectId: string; timeSlots: TimeSlotView[]; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await run("add-slot", async () => {
      await apiFetch(`/api/projects/${projectId}/time-slots`, { method: "POST", body: JSON.stringify({ name, start, end }) });
      setName("");
      toast.success("班次模板已新增");
    });
  }

  return (
    <div className="stack-sm">
      <div className="callout-strip">时间模板由项目 PM 统一维护，责任组负责人在模板内排班。班次允许跨夜；两个班次的时间范围不能重叠。</div>
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">时间段 / 班次模板</h2><div className="section-sub">项目统一班次，责任组按星期与班次配置处理人。调整模板后从下一个班次开始逐步生效。</div></div></div>
        <div className="table-wrap">
          <table className="table config-table">
            <thead><tr><th>班次名称</th><th>开始</th><th>结束</th><th>已配置排班</th><th></th></tr></thead>
            <tbody>
              {timeSlots.length === 0 ? <tr><td colSpan={5}><div className="table-empty">暂无班次模板。</div></td></tr> : timeSlots.map((slot) => (
                <TimeSlotRow key={`${slot.id}-${slot.name}-${slot.startMinute}-${slot.endMinute}`} projectId={projectId} slot={slot} isPm={isPm} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {isPm ? (
        <form className="card card-pad" onSubmit={add}>
          <div className="panel-title">新增班次模板</div>
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 180 }}><label>名称</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={30} placeholder="例如：中班" /></div>
            <div className="field" style={{ maxWidth: 120 }}><label>开始时间</label><input className="input" type="time" value={start} onChange={(event) => setStart(event.target.value)} required /></div>
            <div className="field" style={{ maxWidth: 120 }}><label>结束时间</label><input className="input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} required /></div>
            <button className="btn btn-secondary" type="submit" disabled={busy !== null}><Plus size={14} /> 新增班次</button>
          </div>
          <div className="field-hint" style={{ marginTop: 6 }}>如结束时间早于开始时间，表示跨夜班次；跨夜排班归属开始日期的星期。</div>
        </form>
      ) : null}
    </div>
  );
}

function TimeSlotRow({ projectId, slot, isPm, busy, run }: {
  projectId: string; slot: TimeSlotView; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(slot.name);
  const [start, setStart] = useState(minutesString(slot.startMinute));
  const [end, setEnd] = useState(minutesString(slot.endMinute));
  return (
    <tr>
      <td><input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input" type="time" value={start} onChange={(event) => setStart(event.target.value)} disabled={!isPm} /></td>
      <td><input className="input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} disabled={!isPm} /></td>
      <td className="mono">{slot.scheduleCount}</td>
      <td className="actions">
        {isPm ? <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => void run(`save-slot-${slot.id}`, async () => {
            await apiFetch(`/api/projects/${projectId}/time-slots/${slot.id}`, { method: "PATCH", body: JSON.stringify({ name, start, end }) });
            toast.success("班次已保存");
          })}><Check size={12} /> 保存</button>
          <button type="button" className="icon-btn danger" disabled={busy !== null || slot.scheduleCount > 0} title={slot.scheduleCount > 0 ? "已有排班使用，不能删除" : "删除"} onClick={async () => {
            if (!window.confirm(`确定删除班次「${slot.name}」吗？`)) return;
            await run(`delete-slot-${slot.id}`, async () => {
              await apiFetch(`/api/projects/${projectId}/time-slots/${slot.id}`, { method: "DELETE" });
              toast.success("班次已删除");
            });
          }}><Trash2 size={13} /></button>
        </div> : <span className="hint">只读</span>}
      </td>
    </tr>
  );
}

function HolidaySection({ projectId, holidays, isPm, busy, run }: {
  projectId: string; holidays: HolidayView[]; isPm: boolean; busy: string | null;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
}) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await run("add-holiday", async () => {
      await apiFetch(`/api/projects/${projectId}/holidays`, { method: "POST", body: JSON.stringify({ date, name }) });
      setName("");
      toast.success("节假日已添加；组负责人可针对该日期配置节假日覆盖调班");
    });
  }

  return (
    <div className="stack-sm">
      <div className="callout-strip">节假日仅作为项目日期标记；实际值班安排由组负责人在组内配置「节假日覆盖」临时调班，按具体日期覆盖星期模板。</div>
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">节假日日历</h2><div className="section-sub">作为排班和沟通地图的日期提示。</div></div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>日期</th><th>名称</th><th>添加时间</th><th></th></tr></thead>
            <tbody>
              {holidays.length === 0 ? <tr><td colSpan={4}><div className="table-empty">暂无节假日。</div></td></tr> : holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td className="mono">{holiday.date}</td>
                  <td>{holiday.name}</td>
                  <td className="mini-meta">{holiday.createdAt.slice(0, 10)}</td>
                  <td className="actions">{isPm ? <button type="button" className="icon-btn danger" disabled={busy !== null} onClick={() => void run(`delete-holiday-${holiday.id}`, async () => {
                    await apiFetch(`/api/projects/${projectId}/holidays/${holiday.id}`, { method: "DELETE" });
                    toast.success("节假日已删除");
                  })}><Trash2 size={13} /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {isPm ? (
        <form className="card card-pad" onSubmit={add}>
          <div className="panel-title">新增节假日</div>
          <div className="inline-form">
            <div className="field" style={{ maxWidth: 160 }}><label>日期</label><input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></div>
            <div className="field" style={{ maxWidth: 240 }}><label>名称</label><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={50} placeholder="例如：国庆节" /></div>
            <button className="btn btn-secondary" type="submit" disabled={busy !== null}><Plus size={14} /> 添加节假日</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
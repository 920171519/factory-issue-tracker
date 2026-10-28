import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartNoAxesColumnIncreasing, Filter, Search, TrendingUp, X } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { getHighFrequencyStats } from "@/lib/stats";
import { formatShortDateTime, todayLocal, addDays } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "高频报错统计" };

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function StatisticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const query = await searchParams;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  const endDate = single(query.endDate) || todayLocal();
  const startDate = single(query.startDate) || addDays(endDate, -29);
  const groupId = single(query.groupId);
  const categoryId = single(query.categoryId);
  const errorItem = single(query.errorItem);
  const stats = getHighFrequencyStats(projectId, user.id, {
    startDate,
    endDate,
    groupId: groupId || null,
    categoryId: categoryId || null,
    errorItem: errorItem || null,
  });
  const base = `/projects/${projectId}`;
  const activeFilters = [groupId, categoryId, errorItem].filter(Boolean).length;
  const maxTimeline = Math.max(1, ...stats.timeline.map((point) => point.count));
  const visiblePoints = stats.timeline.length > 90
    ? stats.timeline.filter((_, index) => index % Math.ceil(stats.timeline.length / 90) === 0)
    : stats.timeline;
  const chartWidth = 1000;
  const chartHeight = 210;
  const plotLeft = 38;
  const plotRight = 12;
  const plotTop = 12;
  const plotBottom = 30;
  const plotWidth = chartWidth - plotLeft - plotRight;
  const plotHeight = chartHeight - plotTop - plotBottom;
  const gap = plotWidth / Math.max(1, visiblePoints.length);
  const barWidth = Math.max(2, Math.min(24, gap * 0.6));
  const labelEvery = Math.ceil(visiblePoints.length / 9);
  const maxItemCount = Math.max(1, ...stats.items.map((item) => item.count));

  function preserve(overrides: Record<string, string | null>) {
    const sp = new URLSearchParams();
    sp.set("startDate", startDate);
    sp.set("endDate", endDate);
    if (groupId) sp.set("groupId", groupId);
    if (categoryId) sp.set("categoryId", categoryId);
    if (errorItem) sp.set("errorItem", errorItem);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) sp.delete(key);
      else sp.set(key, value);
    }
    return `${base}/statistics?${sp.toString()}`;
  }

  return (
    <div className="page-stack" style={{ paddingTop: 8 }}>
      <div className="page-header">
        <div>
          <div className="page-kicker">Error Intelligence</div>
          <h1 className="page-title">高频报错项统计</h1>
          <p className="page-sub">按项目、责任组与时间段统计报错项出现频率。问题分类是可选筛选标签，不参与责任路由。</p>
        </div>
        <div className="header-actions">
          <Link href={`${base}/issues`} className="btn btn-secondary">返回问题列表</Link>
        </div>
      </div>

      <form className="card card-pad" method="get" action={`${base}/statistics`}>
        <div className="stats-filter">
          <div className="field">
            <label htmlFor="startDate">开始日期</label>
            <input id="startDate" className="input" type="date" name="startDate" defaultValue={stats.startDate} />
          </div>
          <div className="field">
            <label htmlFor="endDate">结束日期</label>
            <input id="endDate" className="input" type="date" name="endDate" defaultValue={stats.endDate} />
          </div>
          <div className="field">
            <label htmlFor="groupId">责任组</label>
            <select id="groupId" className="select" name="groupId" defaultValue={groupId}>
              <option value="">全部责任组</option>
              {stats.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="categoryId">问题分类</label>
            <select id="categoryId" className="select" name="categoryId" defaultValue={categoryId}>
              <option value="">全部分类</option>
              {stats.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary"><Filter size={14} /> 应用筛选</button>
          {activeFilters ? <Link className="btn btn-ghost" href={`${base}/statistics?startDate=${startDate}&endDate=${endDate}`}><X size={14} /> 清除</Link> : null}
        </div>
      </form>

      <div className="card stats-hero">
        <div className="stats-hero-item">
          <div className="label">报错项出现总次数</div>
          <div className="n">{stats.totalOccurrences}</div>
        </div>
        <div className="stats-hero-item">
          <div className="label">去重报错项</div>
          <div className="n">{stats.uniqueItems}</div>
        </div>
        <div className="stats-hero-item">
          <div className="label">统计窗口</div>
          <div className="n" style={{ fontSize: 18, paddingTop: 7 }}>{stats.startDate} <span style={{ color: "var(--muted-2)" }}>—</span> {stats.endDate}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">
              {errorItem ? `「${errorItem}」出现频率时间线` : "全部报错项出现频率时间线"}
            </h2>
            <div className="section-sub">{errorItem ? "点击下方列表中的其他报错项切换时间线。" : "时间线按问题创建日期统计，可选择某个报错项查看其独立频率。"}</div>
          </div>
          {errorItem ? <Link className="link-btn" href={preserve({ errorItem: null })}><X size={12} /> 取消报错项筛选</Link> : null}
        </div>
        <div className="card-body">
          {visiblePoints.length === 0 ? <div className="empty-mini">所选时间段暂无数据。</div> : (
            <>
              <svg className="timeline-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="报错项按日期出现次数柱状图">
                {[0, 0.5, 1].map((ratio) => {
                  const y = plotTop + plotHeight - plotHeight * ratio;
                  return (
                    <g key={ratio}>
                      <line className="timeline-grid" x1={plotLeft} x2={chartWidth - plotRight} y1={y} y2={y} />
                      <text className="timeline-axis" x={plotLeft - 6} y={y + 3} textAnchor="end">{Math.round(maxTimeline * ratio)}</text>
                    </g>
                  );
                })}
                {visiblePoints.map((point, index) => {
                  const height = (point.count / maxTimeline) * plotHeight;
                  return (
                    <g key={point.date}>
                      <rect
                        className="timeline-bar"
                        x={plotLeft + index * gap + (gap - barWidth) / 2}
                        y={plotTop + plotHeight - height}
                        width={barWidth}
                        height={height}
                        rx={Math.min(4, barWidth / 2)}
                        aria-label={`${point.date}：${point.count} 次`}
                      />
                      {index % labelEvery === 0 ? (
                        <text className="timeline-axis" x={plotLeft + index * gap + gap / 2} y={chartHeight - 10} textAnchor="middle">{point.date.slice(5)}</text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              <div className="timeline-labels"><span>{visiblePoints[0]?.date}</span><span>每日出现次数</span><span>{visiblePoints[visiblePoints.length - 1]?.date}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="section-title">高频报错项排行</h2>
            <div className="section-sub">
              {activeFilters ? <><span className="filter-active-badge">已应用 {activeFilters} 个筛选</span> · </> : null}
              按出现次数排序，点击「时间线」可查看单项频率。
            </div>
          </div>
          <ChartNoAxesColumnIncreasing size={18} color="var(--muted-2)" />
        </div>
        <div className="table-wrap">
          <table className="table freq-table">
            <thead><tr><th>#</th><th>报错项</th><th>出现次数</th><th>涉及条码</th><th>责任组</th><th>分类</th><th>最近出现</th><th></th></tr></thead>
            <tbody>
              {stats.items.length === 0 ? (
                <tr><td colSpan={8}><div className="table-empty">{activeFilters ? "没有符合筛选条件的报错项。" : "所选时间段暂无报错项记录。请先在问题详情中填写报错测试项。"}</div></td></tr>
              ) : stats.items.map((item, index) => (
                <tr key={item.errorItem}>
                  <td className="mono" style={{ color: "var(--muted-2)" }}>{String(index + 1).padStart(2, "0")}</td>
                  <td>
                    <Link className="freq-link" href={preserve({ errorItem: item.errorItem })} style={{ color: "var(--ink)" }}>{item.errorItem}</Link>
                    <div className="freq-bar bar-cell" style={{ width: 150 }}><span style={{ width: `${Math.max(3, (item.count / maxItemCount) * 100)}%` }} /></div>
                  </td>
                  <td><span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{item.count}</span></td>
                  <td>{item.barcodeCount}</td>
                  <td><span className="chip-list">{item.groups.length ? item.groups.map((group) => <span key={group} className="chip">{group}</span>) : <span className="hint">—</span>}</span></td>
                  <td>{item.categories.length ? item.categories.join("、") : <span className="hint">—</span>}</td>
                  <td className="mini-meta">{formatShortDateTime(item.lastOccurredAt)}</td>
                  <td className="actions"><Link className="link-btn" href={preserve({ errorItem: item.errorItem })}><TrendingUp size={12} /> 时间线</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="callout-strip"><Search size={14} /> 统计只读取问题详情中的报错测试项，不记录责任矩阵快照；责任追踪请进入条码详情查看转移路径。</div>
    </div>
  );
}
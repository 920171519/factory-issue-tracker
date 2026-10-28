import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireProjectAccess } from "@/lib/access";
import { getMyPendingInProject } from "@/lib/issues";
import { pendingDeletionCount } from "@/lib/deletion";
import { addDays, formatDate, localDateBounds, listDateRange, todayLocal } from "@/lib/time";

export interface CountBucket {
  total: number;
  unlocated: number;
  identified: number;
  pending: number;
}

export interface GroupStat extends CountBucket {
  id: string;
  name: string;
  memberCount: number;
  enabled: boolean;
}

export interface CategoryStat extends CountBucket {
  id: string;
  name: string;
  color: string;
}

export interface StatusStat {
  id: string;
  name: string;
  color: string;
  count: number;
  countsPending: boolean;
  isIdentified: boolean;
}

export interface ProjectHomeStats {
  issueCount: number;
  memberCount: number;
  groupCount: number;
  myPending: number;
  pendingApprovals: number;
  unlocated: number;
  identified: number;
  pending: number;
  rejectedTotal?: number;
  groups: GroupStat[];
  categories: CategoryStat[];
  statuses: StatusStat[];
  recent: {
    id: string;
    barcode: string;
    locationNo: string;
    priority: string;
    categoryName: string | null;
    updatedAt: string;
    groupNames: string[];
    statusNames: string[];
  }[];
}

interface IssueStatusCountRow {
  scope_id: string;
  status_id: string;
  counts_pending: number;
  is_identified: number;
  count: number;
}

function addBucket(target: CountBucket, row: { count: number; counts_pending: number; is_identified: number }): void {
  target.total += row.count;
  if (row.counts_pending === 1) {
    target.pending += row.count;
    if (row.is_identified === 0) target.unlocated += row.count;
  }
  if (row.is_identified === 1) target.identified += row.count;
}

export function getProjectHomeStats(projectId: string, userId: string): ProjectHomeStats {
  requireProjectAccess(userId, projectId);
  const db = getDb();
  const issueCount = (db.prepare("SELECT COUNT(*) AS count FROM issues WHERE project_id = ?").get(projectId) as { count: number }).count;
  const memberCount = (db.prepare("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ?").get(projectId) as { count: number }).count;
  const groupCount = (db.prepare("SELECT COUNT(*) AS count FROM groups WHERE project_id = ?").get(projectId) as { count: number }).count;
  const groupRows = db
    .prepare(
      `SELECT g.id, g.name, g.enabled,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM groups g WHERE g.project_id = ? ORDER BY g.name`,
    )
    .all(projectId) as { id: string; name: string; enabled: number; member_count: number }[];
  const groupCounts = db
    .prepare(
      `SELECT ig.group_id AS scope_id, i.status_id, s.counts_pending, s.is_identified, COUNT(DISTINCT i.id) AS count
       FROM issue_groups ig
       JOIN issues i ON i.id = ig.issue_id
       JOIN statuses s ON s.id = i.status_id
       WHERE i.project_id = ?
       GROUP BY ig.group_id, i.status_id, s.counts_pending, s.is_identified`,
    )
    .all(projectId) as IssueStatusCountRow[];
  const groups: GroupStat[] = groupRows.map((group) => {
    const bucket: CountBucket = { total: 0, unlocated: 0, identified: 0, pending: 0 };
    for (const row of groupCounts.filter((item) => item.scope_id === group.id)) addBucket(bucket, row);
    return {
      id: group.id,
      name: group.name,
      enabled: group.enabled === 1,
      memberCount: group.member_count,
      ...bucket,
    };
  });

  const categoryRows = db
    .prepare("SELECT id, name, color FROM categories WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string; color: string }[];
  const categoryCounts = db
    .prepare(
      `SELECT b.category_id AS scope_id, i.status_id, s.counts_pending, s.is_identified, COUNT(DISTINCT i.id) AS count
       FROM issues i
       JOIN barcodes b ON b.id = i.barcode_id
       JOIN statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND b.category_id IS NOT NULL
       GROUP BY b.category_id, i.status_id, s.counts_pending, s.is_identified`,
    )
    .all(projectId) as IssueStatusCountRow[];
  const categories: CategoryStat[] = categoryRows.map((category) => {
    const bucket: CountBucket = { total: 0, unlocated: 0, identified: 0, pending: 0 };
    for (const row of categoryCounts.filter((item) => item.scope_id === category.id)) addBucket(bucket, row);
    return { ...category, ...bucket };
  });
  const uncategorized = db
    .prepare(
      `SELECT i.status_id, s.counts_pending, s.is_identified, COUNT(DISTINCT i.id) AS count
       FROM issues i JOIN barcodes b ON b.id = i.barcode_id JOIN statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND b.category_id IS NULL
       GROUP BY i.status_id, s.counts_pending, s.is_identified`,
    )
    .all(projectId) as Omit<IssueStatusCountRow, "scope_id">[];
  if (uncategorized.length > 0) {
    const bucket: CountBucket = { total: 0, unlocated: 0, identified: 0, pending: 0 };
    for (const row of uncategorized) addBucket(bucket, row);
    categories.push({ id: "__none__", name: "未分类", color: "#94a3b8", ...bucket });
  }

  const statusRows = db
    .prepare(
      `SELECT s.id, s.name, s.color, s.counts_pending, s.is_identified,
              (SELECT COUNT(*) FROM issues i WHERE i.status_id = s.id AND i.project_id = s.project_id) AS count
       FROM statuses s WHERE s.project_id = ? ORDER BY s.sort_order, s.name`,
    )
    .all(projectId) as {
    id: string;
    name: string;
    color: string;
    counts_pending: number;
    is_identified: number;
    count: number;
  }[];
  const statuses = statusRows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    count: row.count,
    countsPending: row.counts_pending === 1,
    isIdentified: row.is_identified === 1,
  }));
  const unlocated = statusRows.reduce((sum, row) => sum + (row.counts_pending === 1 && row.is_identified === 0 ? row.count : 0), 0);
  const identified = statusRows.reduce((sum, row) => sum + (row.is_identified === 1 ? row.count : 0), 0);
  const pending = statusRows.reduce((sum, row) => sum + (row.counts_pending === 1 ? row.count : 0), 0);

  const recentRows = db
    .prepare(
      `SELECT b.id, b.barcode, b.location_no, b.priority, c.name AS category_name, b.updated_at
       FROM barcodes b LEFT JOIN categories c ON c.id = b.category_id
       WHERE b.project_id = ? ORDER BY b.updated_at DESC LIMIT 6`,
    )
    .all(projectId) as {
    id: string;
    barcode: string;
    location_no: string;
    priority: string;
    category_name: string | null;
    updated_at: string;
  }[];
  const recent = recentRows.map((row) => {
    const groupsForBarcode = db
      .prepare(
        `SELECT DISTINCT g.name FROM issue_groups ig JOIN groups g ON g.id = ig.group_id
         JOIN issues i ON i.id = ig.issue_id WHERE i.barcode_id = ? ORDER BY g.name`,
      )
      .all(row.id) as { name: string }[];
    const statusesForBarcode = db
      .prepare(
        `SELECT DISTINCT s.name FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.barcode_id = ? ORDER BY s.name`,
      )
      .all(row.id) as { name: string }[];
    return {
      id: row.id,
      barcode: row.barcode,
      locationNo: row.location_no,
      priority: row.priority,
      categoryName: row.category_name,
      updatedAt: row.updated_at,
      groupNames: groupsForBarcode.map((item) => item.name),
      statusNames: statusesForBarcode.map((item) => item.name),
    };
  });

  return {
    issueCount,
    memberCount,
    groupCount,
    myPending: getMyPendingInProject(userId, projectId),
    pendingApprovals: pendingDeletionCount(projectId),
    unlocated,
    identified,
    pending,
    groups,
    categories,
    statuses,
    recent,
  };
}

export interface HighFrequencyFilter {
  startDate?: string;
  endDate?: string;
  groupId?: string | null;
  categoryId?: string | null;
  errorItem?: string | null;
}

export interface HighFrequencyItem {
  errorItem: string;
  count: number;
  barcodeCount: number;
  lastOccurredAt: string;
  groups: string[];
  categories: string[];
  barcodes: { id: string; barcode: string; createdAt: string; status: string }[];
}

export interface HighFrequencyStats {
  startDate: string;
  endDate: string;
  groupId: string | null;
  categoryId: string | null;
  errorItem: string | null;
  totalOccurrences: number;
  uniqueItems: number;
  items: HighFrequencyItem[];
  timeline: { date: string; count: number }[];
  groups: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
}

interface FrequencyRow {
  issue_id: string;
  barcode_id: string;
  barcode: string;
  error_item: string;
  created_at: string;
  status_name: string;
  category_name: string | null;
  group_names: string | null;
}

export function getHighFrequencyStats(
  projectId: string,
  userId: string,
  filter: HighFrequencyFilter = {},
): HighFrequencyStats {
  requireProjectAccess(userId, projectId);
  const db = getDb();
  const endDate = filter.endDate || todayLocal();
  const startDate = filter.startDate || addDays(endDate, -29);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new AppError(400, "日期格式应为 YYYY-MM-DD");
  }
  if (endDate < startDate) throw new AppError(400, "结束日期不能早于开始日期");
  const days = listDateRange(startDate, endDate);
  if (days.length > 366) throw new AppError(400, "统计时间范围最大为 366 天");
  const { start } = localDateBounds(startDate);
  const { endExclusive } = localDateBounds(endDate);
  const groups = db
    .prepare("SELECT id, name FROM groups WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string }[];
  const categories = db
    .prepare("SELECT id, name, color FROM categories WHERE project_id = ? ORDER BY name")
    .all(projectId) as { id: string; name: string; color: string }[];

  const conditions = ["i.project_id = ?", "i.error_item <> ''", "i.created_at >= ?", "i.created_at < ?"];
  const params: (string | number)[] = [projectId, start, endExclusive];
  if (filter.groupId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM issue_groups igf WHERE igf.issue_id = i.id AND igf.group_id = ?)",
    );
    params.push(filter.groupId);
  }
  if (filter.categoryId) {
    conditions.push("b.category_id = ?");
    params.push(filter.categoryId);
  }
  const rows = db
    .prepare(
      `SELECT i.id AS issue_id, i.barcode_id, b.barcode, i.error_item, i.created_at,
              s.name AS status_name, c.name AS category_name,
              (SELECT GROUP_CONCAT(g.name, '、') FROM issue_groups ig
               JOIN groups g ON g.id = ig.group_id WHERE ig.issue_id = i.id) AS group_names
       FROM issues i
       JOIN barcodes b ON b.id = i.barcode_id
       JOIN statuses s ON s.id = i.status_id
       LEFT JOIN categories c ON c.id = b.category_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.created_at`,
    )
    .all(...params) as FrequencyRow[];

  const aggregate = new Map<string, {
    display: string;
    count: number;
    barcodeIds: Set<string>;
    lastOccurredAt: string;
    groups: Set<string>;
    categories: Set<string>;
    barcodes: { id: string; barcode: string; createdAt: string; status: string }[];
  }>();
  for (const row of rows) {
    const key = row.error_item.trim().toLocaleLowerCase();
    const entry = aggregate.get(key) || {
      display: row.error_item.trim(),
      count: 0,
      barcodeIds: new Set<string>(),
      lastOccurredAt: row.created_at,
      groups: new Set<string>(),
      categories: new Set<string>(),
      barcodes: [],
    };
    entry.count += 1;
    entry.barcodeIds.add(row.barcode_id);
    if (row.created_at > entry.lastOccurredAt) entry.lastOccurredAt = row.created_at;
    if (row.group_names) for (const name of row.group_names.split("、")) entry.groups.add(name);
    if (row.category_name) entry.categories.add(row.category_name);
    if (!entry.barcodes.some((barcode) => barcode.id === row.barcode_id)) {
      entry.barcodes.push({ id: row.barcode_id, barcode: row.barcode, createdAt: row.created_at, status: row.status_name });
    }
    aggregate.set(key, entry);
  }
  const items: HighFrequencyItem[] = [...aggregate.values()]
    .map((entry) => ({
      errorItem: entry.display,
      count: entry.count,
      barcodeCount: entry.barcodeIds.size,
      lastOccurredAt: entry.lastOccurredAt,
      groups: [...entry.groups],
      categories: [...entry.categories],
      barcodes: entry.barcodes,
    }))
    .sort((a, b) => b.count - a.count || b.lastOccurredAt.localeCompare(a.lastOccurredAt));

  const selectedItem = filter.errorItem?.trim().toLocaleLowerCase();
  const timelineRows = selectedItem
    ? rows.filter((row) => row.error_item.trim().toLocaleLowerCase() === selectedItem)
    : rows;
  const countByDay = new Map<string, number>();
  for (const row of timelineRows) {
    const date = formatDate(row.created_at).slice(0, 10);
    countByDay.set(date, (countByDay.get(date) || 0) + 1);
  }
  const timeline = days.map((date) => ({ date, count: countByDay.get(date) || 0 }));
  return {
    startDate,
    endDate,
    groupId: filter.groupId || null,
    categoryId: filter.categoryId || null,
    errorItem: filter.errorItem || null,
    totalOccurrences: selectedItem ? timelineRows.length : rows.length,
    uniqueItems: items.length,
    items,
    timeline,
    groups,
    categories,
  };
}

export function getAnomaliesForProject(projectId: string, userId: string, limit = 50): {
  id: string;
  message: string;
  createdAt: string;
  groupName: string | null;
  barcode: string | null;
}[] {
  requireProjectAccess(userId, projectId);
  return getDb()
    .prepare(
      `SELECT a.id, a.message, a.created_at AS createdAt, g.name AS groupName, b.barcode
       FROM anomalies a
       LEFT JOIN groups g ON g.id = a.group_id
       LEFT JOIN issues i ON i.id = a.issue_id
       LEFT JOIN barcodes b ON b.id = i.barcode_id
       WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as { id: string; message: string; createdAt: string; groupName: string | null; barcode: string | null }[];
}
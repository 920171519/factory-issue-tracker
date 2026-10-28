import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import {
  getBarcodeBase,
  getDefaultGroupIds,
  getGroupMemberRefs,
  getProjectCategories,
  getProjectGroups,
  getProjectStatuses,
} from "@/lib/issues";
import { IssuesWorkspace } from "@/components/issues/IssuesWorkspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "问题跟踪" };

export default async function IssuesPage({
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

  const rawGroups = getProjectGroups(projectId);
  const memberRefs = getGroupMemberRefs(rawGroups.map((group) => group.id));
  const groups = rawGroups.map((group) => ({
    id: group.id,
    name: group.name,
    enabled: group.enabled === 1,
    members: memberRefs[group.id] || [],
  }));
  const statuses = getProjectStatuses(projectId);
  const categories = getProjectCategories(projectId);
  const defaultGroupIds = getDefaultGroupIds(projectId);

  const initialBarcodeId = typeof query.barcode === "string" ? query.barcode : undefined;
  let initialBarcodeLabel: string | undefined;
  if (initialBarcodeId) {
    const base = getBarcodeBase(projectId, initialBarcodeId);
    initialBarcodeLabel = base?.barcode;
  }
  const initialOpenCreate = query.new === "1";

  return (
    <IssuesWorkspace
      projectId={projectId}
      currentUser={{ id: user.id, name: user.name, employeeNo: user.employeeNo }}
      access={{
        isPm: access.isPm,
        isSupervisor: access.isSupervisor,
        isGroupLeader: access.isGroupLeader,
        groupIds: access.groupIds,
        leaderGroupIds: access.leaderGroupIds,
      }}
      groups={groups}
      defaultGroupIds={defaultGroupIds}
      statuses={statuses}
      categories={categories}
      initialBarcodeId={initialBarcodeLabel ? initialBarcodeId : undefined}
      initialBarcodeLabel={initialBarcodeLabel}
      initialOpenCreate={initialOpenCreate}
    />
  );
}

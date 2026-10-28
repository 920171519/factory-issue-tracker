import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { getGroupDetails } from "@/lib/groups";
import { GroupDetailClient } from "@/components/groups/GroupDetailClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任组详情" };

export default async function GroupDetailPage({ params }: { params: Promise<{ projectId: string; groupId: string }> }) {
  const user = await requirePageUser();
  const { projectId, groupId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  const data = getGroupDetails(projectId, groupId, user.id);
  return <GroupDetailClient projectId={projectId} data={data} isPm={access.isPm} />;
}

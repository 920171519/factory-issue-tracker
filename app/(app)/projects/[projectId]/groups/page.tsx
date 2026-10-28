import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { groupMemberOptions, listGroupCards } from "@/lib/groups";
import { GroupsClient } from "@/components/groups/GroupsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "责任组" };

export default async function GroupsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  const groups = listGroupCards(projectId, user.id);
  const memberOptions = groupMemberOptions(projectId);
  return <GroupsClient projectId={projectId} groups={groups} memberOptions={memberOptions} isPm={access.isPm} />;
}

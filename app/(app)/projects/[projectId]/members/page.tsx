import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { listProjectMembers } from "@/lib/projects";
import { MembersClient } from "@/components/members/MembersClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目成员" };

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access || (!access.isPm && !access.isSupervisor)) notFound();
  const members = listProjectMembers(projectId);
  return <MembersClient projectId={projectId} members={members} isPm={access.isPm} />;
}

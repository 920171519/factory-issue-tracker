import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { listDeletionRequests } from "@/lib/deletion";
import { ApprovalsClient } from "@/components/approvals/ApprovalsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "删除审批" };

export default async function ApprovalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access || (!access.isPm && !access.isSupervisor)) notFound();
  const requests = listDeletionRequests(projectId);
  return <ApprovalsClient projectId={projectId} requests={requests} isPm={access.isPm} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { getProjectMemberOptions, listCodes, listHosts } from "@/lib/taxonomy";
import { InfoClient } from "@/components/info/InfoClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "基础信息" };

export default async function InfoPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  return (
    <InfoClient
      projectId={projectId}
      codes={listCodes(projectId)}
      hosts={listHosts(projectId)}
      memberOptions={getProjectMemberOptions(projectId)}
      isPm={access.isPm}
    />
  );
}

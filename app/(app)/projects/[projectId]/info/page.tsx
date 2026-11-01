import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { listHosts } from "@/lib/taxonomy";
import { countPackages } from "@/lib/packages";
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
      hosts={listHosts(projectId)}
      packageCount={countPackages(projectId)}
      isPm={access.isPm}
    />
  );
}

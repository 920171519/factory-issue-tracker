import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { getCommunicationData } from "@/lib/groups";
import { CommunicationClient } from "@/components/communication/CommunicationClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "沟通地图" };

export default async function CommunicationPage({
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
  const data = getCommunicationData(projectId, user.id);
  const serializable = {
    ...data,
    groups: data.groups.map((group) => ({
      ...group,
      resolution: group.resolution
        ? {
            ...group.resolution,
            primaryCounts: group.resolution.primaryCounts,
          }
        : null,
    })),
  };
  return (
    <CommunicationClient
      projectId={projectId}
      initialData={serializable}
      initialGroupFilter={
        typeof query.group === "string"
          ? data.groups.find((group) => group.id === query.group)?.name || query.group
          : undefined
      }
    />
  );
}
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { PackagesWorkspace } from "@/components/packages/PackagesWorkspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "软件包管理" };

export default async function PackagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  return <PackagesWorkspace projectId={projectId} currentUser={{ id: user.id, name: user.name }} />;
}

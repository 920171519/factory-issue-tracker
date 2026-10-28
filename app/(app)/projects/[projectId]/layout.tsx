import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/access";
import { pendingDeletionCount } from "@/lib/deletion";
import { ProjectNav } from "@/components/ProjectNav";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  if (!access) notFound();
  const pendingApprovals = pendingDeletionCount(projectId);
  return (
    <div className="project-shell">
      <ProjectNav
        projectId={projectId}
        projectName={access.project.name}
        projectCode={access.project.code}
        isPm={access.isPm}
        isSupervisor={access.isSupervisor}
        isGroupLeader={access.isGroupLeader}
        pendingApprovals={pendingApprovals}
      />
      <main className="project-main">{children}</main>
    </div>
  );
}

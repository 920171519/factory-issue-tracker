import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { getProject, getProjectAccess } from "@/lib/access";
import { listCategories, listDefaultGroupIds, listHolidays, listStatuses, listTimeSlotViews } from "@/lib/taxonomy";
import { getProjectGroups } from "@/lib/issues";
import { ProjectSettingsClient } from "@/components/settings/ProjectSettingsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "项目配置" };

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const access = getProjectAccess(user.id, projectId);
  const project = getProject(projectId);
  if (!access || !project || (!access.isPm && !access.isSupervisor)) notFound();
  return (
    <ProjectSettingsClient
      project={project}
      projectId={projectId}
      categories={listCategories(projectId)}
      statuses={listStatuses(projectId)}
      timeSlots={listTimeSlotViews(projectId)}
      groups={getProjectGroups(projectId)}
      defaultGroupIds={listDefaultGroupIds(projectId)}
      holidays={listHolidays(projectId)}
      isPm={access.isPm}
    />
  );
}

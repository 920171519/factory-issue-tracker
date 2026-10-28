import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { listProjectsForUser } from "@/lib/projects";
import { ProjectsClient } from "@/components/ProjectsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的项目" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const projects = listProjectsForUser(user.id);
  return (
    <div className="container">
      <ProjectsClient projects={projects} userName={user.name} canCreateProject={user.isSystemAdmin} />
    </div>
  );
}

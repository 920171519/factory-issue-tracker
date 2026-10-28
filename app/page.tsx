import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function IndexPage() {
  const user = await getPageUser();
  redirect(user ? "/projects" : "/login");
}

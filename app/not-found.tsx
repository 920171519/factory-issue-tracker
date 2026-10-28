import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container">
      <div className="card empty-state" style={{ marginTop: 48 }}>
        <div className="empty-icon"><SearchX size={22} /></div>
        <h3>页面不存在或无权访问</h3>
        <p>请检查项目或问题是否仍然存在，或联系项目 PM 确认你的项目权限。</p>
        <Link href="/projects" className="btn btn-primary" style={{ marginTop: 16 }}>返回我的项目</Link>
      </div>
    </div>
  );
}

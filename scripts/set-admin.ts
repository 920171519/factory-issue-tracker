import { getDb, closeDb } from "../lib/db";

const employeeNo = process.argv[2]?.trim();
if (!employeeNo) {
  console.error("用法：pnpm admin:grant <工号>");
  process.exit(1);
}
const db = getDb();
const user = db.prepare("SELECT id, name FROM users WHERE employee_no = ?").get(employeeNo) as { id: string; name: string } | undefined;
if (!user) {
  console.error("未找到该工号用户：" + employeeNo);
  closeDb();
  process.exit(1);
}
db.prepare("UPDATE users SET is_system_admin = 1 WHERE id = ?").run(user.id);
console.log(`已将 ${user.name}（${employeeNo}）设为系统管理员`);
closeDb();

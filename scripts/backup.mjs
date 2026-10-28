import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const databasePath = process.env.DATABASE_PATH || "./data/app.db";
const uploadDir = process.env.UPLOAD_DIR || "./data/uploads";
const backupRoot = process.env.BACKUP_DIR || "./backups";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupRoot, stamp);

await fs.mkdir(destination, { recursive: true });
const source = path.resolve(databasePath);
await fs.access(source);

const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(path.join(destination, "app.db"));
db.close();

try {
  await fs.access(path.resolve(uploadDir));
  await fs.cp(path.resolve(uploadDir), path.join(destination, "uploads"), { recursive: true });
} catch {
  // Upload directory is optional before the first image is uploaded.
}

console.log("备份完成：" + path.resolve(destination));
console.log("数据库：" + path.join(path.resolve(destination), "app.db"));
console.log("上传目录：" + path.join(path.resolve(destination), "uploads"));
console.log("请将备份目录复制到独立存储，并按保留策略清理旧备份。");

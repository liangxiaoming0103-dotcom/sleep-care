/**
 * 数据库迁移脚本：将 users 表的 role 字段从 INTEGER 转换为 TEXT
 *
 * 转换前：0=patient  1=doctor  2=admin
 * 转换后：'patient'  'doctor'  'admin'
 *
 * 用法：
 *   node backend/db/migrate-role.js
 *
 * 幂等安全：已转为 TEXT 的行不会被重复修改
 */

const { getDb, saveDb } = require('./connection');

async function migrateRole() {
  const db = await getDb();

  console.log('[迁移] 开始转换 role 字段 INTEGER → TEXT …');

  // 映射表：INTEGER → TEXT
  const map = { 0: 'patient', 1: 'doctor', 2: 'admin' };

  // 查询所有 role 仍为整数的行（SQLite 中 typeof(role) = 'integer' 表示未迁移）
  const stmt = db.prepare("SELECT id, role FROM users WHERE typeof(role) = 'integer'");
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  if (rows.length === 0) {
    console.log('[迁移] 无需迁移，所有 role 已是 TEXT 格式');
    return;
  }

  console.log(`[迁移] 发现 ${rows.length} 条需转换的记录`);

  // 逐行更新
  for (const row of rows) {
    const newRole = map[row.role];
    if (!newRole) {
      console.warn(`[迁移] ⚠ 跳过未知 role 值：user_id=${row.id}, role=${row.role}`);
      continue;
    }
    db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, row.id]);
    console.log(`[迁移] ✓ user_id=${row.id}: ${row.role} → '${newRole}'`);
  }

  saveDb();
  console.log('[迁移] 迁移完成，数据库已保存');
}

migrateRole().catch(err => {
  console.error('[迁移] 失败：', err);
  process.exit(1);
});

/**
 * 数据库 Schema 初始化模块
 * 执行 DDL 建表语句（CREATE TABLE IF NOT EXISTS）和索引创建，确保所有核心表就绪。
 */

const { getDb, saveDb } = require('./connection');

/**
 * 初始化数据库表结构
 * 创建 5 张核心表 + 6 个索引，所有语句使用 IF NOT EXISTS 保证幂等性。
 * 执行完成后自动调用 saveDb() 持久化。
 */
async function initSchema() {
  const db = await getDb();

  console.log('[Schema] 开始初始化数据库表结构...');

  // =====================================================
  // 1. 用户表 users
  // 注意：role 使用 TEXT 存储（'patient'/'doctor'/'admin'），
  //       status：1=正常 0=禁用（与旧文档相反，以代码为准）
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone           TEXT    NOT NULL UNIQUE,
      password_hash   TEXT    NOT NULL,
      nickname        TEXT    NOT NULL DEFAULT '用户',
      avatar_url      TEXT    NULL,
      gender          INTEGER NOT NULL DEFAULT 0,
      birth_year      INTEGER NULL,
      role            TEXT    NOT NULL DEFAULT 'patient',
      status          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT    NULL
    );
  `);
  console.log('[Schema] ✓ users 表');

  // 兼容旧数据库：为已存在的 users 表添加 updated_at 列（若不存在）
  try {
    db.run('ALTER TABLE users ADD COLUMN updated_at TEXT NULL;');
  } catch (_) {
    // 列已存在时忽略错误（SQLite 不支持 IF NOT EXISTS 的 ALTER TABLE）
  }

  // =====================================================
  // 2. 设备表 devices
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_no     TEXT    NOT NULL UNIQUE,
      user_id       INTEGER NOT NULL,
      nickname      TEXT    NOT NULL DEFAULT '我的设备',
      is_virtual    INTEGER NOT NULL DEFAULT 1,
      online_status INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ devices 表');

  // =====================================================
  // 3. 睡眠报告表 sleep_reports
  // 注意：UNIQUE(user_id, report_date) 通过下方唯一索引实现
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS sleep_reports (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      device_id           INTEGER NOT NULL,
      report_date         TEXT    NOT NULL,
      sleep_score         INTEGER NOT NULL,
      total_sleep_minutes INTEGER NOT NULL,
      deep_sleep_minutes  INTEGER NOT NULL,
      light_sleep_minutes INTEGER NOT NULL,
      rem_sleep_minutes   INTEGER NOT NULL,
      awake_minutes       INTEGER NOT NULL DEFAULT 0,
      awake_count         INTEGER NOT NULL DEFAULT 0,
      heart_rate_json     TEXT,
      sleep_stages_json   TEXT,
      noise_json          TEXT,
      breath_rate_json    TEXT,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ sleep_reports 表');

  // 兼容旧数据库：为已存在的 sleep_reports 表添加 breath_rate_json 列
  try {
    db.run('ALTER TABLE sleep_reports ADD COLUMN breath_rate_json TEXT;');
  } catch (_) {
    // 列已存在
  }

  // =====================================================
  // 4. 用户设置表 user_settings
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id                INTEGER PRIMARY KEY,
      bedtime                TEXT    NOT NULL DEFAULT '23:00:00',
      wakeup_time            TEXT    NOT NULL DEFAULT '07:00:00',
      sunrise_duration       INTEGER NOT NULL DEFAULT 10,
      sound_preference       TEXT    NOT NULL DEFAULT 'white_noise',
      wake_sound             TEXT    NOT NULL DEFAULT 'bird',
      preferred_brightness   INTEGER NOT NULL DEFAULT 50,
      preferred_volume       INTEGER NOT NULL DEFAULT 40,
      device_timezone        TEXT    NOT NULL DEFAULT 'Asia/Shanghai',
      do_not_disturb_enabled INTEGER NOT NULL DEFAULT 0,
      dnd_start              TEXT    NOT NULL DEFAULT '23:00:00',
      dnd_end                TEXT    NOT NULL DEFAULT '06:00:00',
      created_at             TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ user_settings 表');

  // =====================================================
  // 5. 医生授权表 doctor_authorizations
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS doctor_authorizations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id   INTEGER NOT NULL,
      doctor_id    INTEGER NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      expire_date  TEXT    NOT NULL,
      doctor_note  TEXT,
      requested_at TEXT    NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id)  REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ doctor_authorizations 表');

  // =====================================================
  // 索引（提升查询性能）
  // 注意：唯一索引创建前先清理已存在的重复数据（保留 id 最大的那条）
  // =====================================================
  db.run(`
    DELETE FROM sleep_reports
    WHERE id NOT IN (
      SELECT MAX(id) FROM sleep_reports GROUP BY user_id, report_date
    );
  `);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS uk_sleep_reports_user_date ON sleep_reports(user_id, report_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sleep_reports_user_id         ON sleep_reports(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sleep_reports_report_date     ON sleep_reports(report_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_devices_user_id               ON devices(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_doctor_auth_doctor_id         ON doctor_authorizations(doctor_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_doctor_auth_patient_id        ON doctor_authorizations(patient_id)');
  console.log('[Schema] ✓ 6 个索引（含 1 个唯一索引）');

  // 持久化到磁盘
  saveDb();
  console.log('[Schema] 数据库表结构初始化完成');
}

module.exports = { initSchema };

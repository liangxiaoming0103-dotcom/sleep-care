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
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id         INTEGER PRIMARY KEY AUTOINCREMENT,
      phone           TEXT    NOT NULL UNIQUE,
      password_hash   TEXT    NOT NULL,
      nickname        TEXT    NOT NULL DEFAULT '用户',
      avatar_url      TEXT    NULL,
      gender          INTEGER NOT NULL DEFAULT 0,
      birth_year      INTEGER NULL,
      role            INTEGER NOT NULL DEFAULT 0,
      status          INTEGER NOT NULL DEFAULT 0,
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
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ devices 表');

  // =====================================================
  // 3. 睡眠报告表 sleep_reports
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS sleep_reports (
      report_id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      device_id         INTEGER NOT NULL,
      report_date       TEXT    NOT NULL,
      sleep_score       INTEGER NOT NULL DEFAULT 0,
      total_minutes     INTEGER NOT NULL DEFAULT 0,
      deep_minutes      INTEGER NOT NULL DEFAULT 0,
      rem_minutes       INTEGER NOT NULL DEFAULT 0,
      light_minutes     INTEGER NOT NULL DEFAULT 0,
      wake_minutes      INTEGER NOT NULL DEFAULT 0,
      avg_heart_rate    REAL    NULL,
      events_json       TEXT    NULL,
      heart_rate_curve  TEXT    NULL,
      respiration_curve TEXT    NULL,
      stage_curve       TEXT    NULL,
      noise_curve       TEXT    NULL,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id)   REFERENCES users(user_id)   ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      UNIQUE(user_id, report_date)
    );
  `);
  console.log('[Schema] ✓ sleep_reports 表');

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
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ user_settings 表');

  // =====================================================
  // 5. 医生授权表 doctor_authorizations
  // =====================================================
  db.run(`
    CREATE TABLE IF NOT EXISTS doctor_authorizations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_user_id  INTEGER NOT NULL,
      doctor_user_id   INTEGER NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','active','expired','revoked')),
      expire_at        TEXT    NOT NULL,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (patient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_user_id)  REFERENCES users(user_id) ON DELETE CASCADE
    );
  `);
  console.log('[Schema] ✓ doctor_authorizations 表');

  // =====================================================
  // 索引（提升查询性能）
  // =====================================================
  db.run('CREATE INDEX IF NOT EXISTS idx_devices_user_id    ON devices(user_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_user_date   ON sleep_reports(user_id, report_date);');
  db.run('CREATE INDEX IF NOT EXISTS idx_reports_device_id   ON sleep_reports(device_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_auth_patient        ON doctor_authorizations(patient_user_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_auth_doctor         ON doctor_authorizations(doctor_user_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_auth_status         ON doctor_authorizations(status);');
  console.log('[Schema] ✓ 6 个索引');

  // 持久化到磁盘
  saveDb();
  console.log('[Schema] 数据库表结构初始化完成');
}

module.exports = { initSchema };

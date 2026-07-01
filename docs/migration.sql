-- ============================================================
-- SQLite → MySQL 迁移脚本
-- 智能睡眠健康管理软件 — 数据库 DDL
--
-- 用法：
--   mysql -u root -p < docs/migration.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS sleep_care
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE sleep_care;

-- ============================================================
-- 1. 用户表 users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              INT           NOT NULL AUTO_INCREMENT,
    phone           VARCHAR(20)   NOT NULL,
    password_hash   VARCHAR(255)  NOT NULL,
    nickname        VARCHAR(50)   NOT NULL DEFAULT '用户',
    avatar_url      VARCHAR(500)  NULL,
    gender          TINYINT       NOT NULL DEFAULT 0 COMMENT '0=未知 1=男 2=女',
    birth_year      INT           NULL,
    role            VARCHAR(16)   NOT NULL DEFAULT 'patient' COMMENT 'patient/doctor/admin',
    status          TINYINT       NOT NULL DEFAULT 0 COMMENT '0=正常 1=禁用',
    created_at      DATETIME      NOT NULL DEFAULT NOW(),
    updated_at      DATETIME      NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. 设备表 devices
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
    id            INT           NOT NULL AUTO_INCREMENT,
    serial_no     VARCHAR(32)   NOT NULL,
    user_id       INT           NOT NULL,
    nickname      VARCHAR(50)   NOT NULL DEFAULT '我的设备',
    is_virtual    TINYINT       NOT NULL DEFAULT 1 COMMENT '1=虚拟 0=真实',
    online_status TINYINT       NOT NULL DEFAULT 1 COMMENT '1=在线 0=离线',
    created_at    DATETIME      NOT NULL DEFAULT NOW(),
    updated_at    DATETIME      NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uk_serial_no (serial_no),
    KEY idx_devices_user_id (user_id),
    CONSTRAINT fk_devices_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. 睡眠报告表 sleep_reports
-- ============================================================
CREATE TABLE IF NOT EXISTS sleep_reports (
    id                  INT      NOT NULL AUTO_INCREMENT,
    user_id             INT      NOT NULL,
    device_id           INT      NOT NULL,
    report_date         DATE     NOT NULL,
    sleep_score         INT      NOT NULL COMMENT '0-100',
    total_sleep_minutes INT      NOT NULL,
    deep_sleep_minutes  INT      NOT NULL,
    light_sleep_minutes INT      NOT NULL,
    rem_sleep_minutes   INT      NOT NULL,
    awake_minutes       INT      NOT NULL DEFAULT 0,
    awake_count         INT      NOT NULL DEFAULT 0,
    heart_rate_json     JSON     NULL COMMENT '心率JSON数组',
    sleep_stages_json   JSON     NULL COMMENT '分期JSON数组',
    noise_json          JSON     NULL COMMENT '噪音JSON数组',
    breath_rate_json    JSON     NULL COMMENT '呼吸频率JSON数组',
    created_at          DATETIME NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE KEY uk_report (user_id, report_date),
    KEY idx_sleep_reports_user_id (user_id),
    KEY idx_sleep_reports_report_date (report_date),
    KEY idx_sleep_reports_device_id (device_id),
    CONSTRAINT fk_report_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_device
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. 用户设置表 user_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS user_settings (
    user_id                INT          NOT NULL,
    bedtime                TIME         NOT NULL DEFAULT '23:00:00',
    wakeup_time            TIME         NOT NULL DEFAULT '07:00:00',
    sunrise_duration       INT          NOT NULL DEFAULT 10 COMMENT '5-30分钟',
    sound_preference       VARCHAR(32)  NOT NULL DEFAULT 'white_noise' COMMENT 'white_noise/wave/rain/fire',
    wake_sound             VARCHAR(32)  NOT NULL DEFAULT 'bird',
    preferred_brightness   INT          NOT NULL DEFAULT 50 COMMENT '0-100',
    preferred_volume       INT          NOT NULL DEFAULT 40 COMMENT '0-100',
    device_timezone        VARCHAR(64)  NOT NULL DEFAULT 'Asia/Shanghai',
    do_not_disturb_enabled TINYINT      NOT NULL DEFAULT 0,
    dnd_start              TIME         NOT NULL DEFAULT '23:00:00',
    dnd_end                TIME         NOT NULL DEFAULT '06:00:00',
    created_at             DATETIME     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_settings_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. 医生授权表 doctor_authorizations
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_authorizations (
    id           INT          NOT NULL AUTO_INCREMENT,
    patient_id   INT          NOT NULL,
    doctor_id    INT          NOT NULL,
    status       VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/active/expired/revoked',
    expire_date  DATE         NOT NULL,
    doctor_note  TEXT         NULL COMMENT '医生干预建议',
    requested_at DATETIME     NOT NULL DEFAULT NOW(),
    responded_at DATETIME     NULL,
    created_at   DATETIME     NOT NULL DEFAULT NOW(),
    updated_at   DATETIME     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    KEY idx_doctor_auth_doctor_id (doctor_id),
    KEY idx_doctor_auth_patient_id (patient_id),
    KEY idx_doctor_auth_status (status),
    CONSTRAINT fk_auth_patient
        FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_auth_doctor
        FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

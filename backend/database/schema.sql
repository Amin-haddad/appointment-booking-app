-- ============================================================
-- File: backend/database/schema.sql
-- SRS References: FR-01, FR-02, FR-03, FR-05, FR-06, FR-07,
--                 FR-08, FR-09, FR-10, NFR Performance/Security
-- SRS v1.0, April 2026
-- MySQL 8.0+
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO';

-- ============================================================
-- TABLE: users
-- FR-01: User Registration — stores hashed passwords, email
--        verification status, role-based access control
-- FR-02: Authentication — is_active, is_verified guards
-- NFR Security, Page 8: "Passwords hashed with bcrypt (cost 12+)"
-- SRS Section 2: Three actors — client, admin, system
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    full_name       VARCHAR(150)        NOT NULL,
    email           VARCHAR(255)        NOT NULL,
    -- FR-01: bcrypt hash stored, never plaintext [NFR Security, Page 8]
    password_hash   VARCHAR(255)        NOT NULL
                        COMMENT 'bcrypt hash, cost factor 12+ [NFR Security, Page 8]',
    -- SRS Section 2, Page 5: RBAC — client vs admin roles
    role            ENUM('client','admin')
                                        NOT NULL DEFAULT 'client',
    -- FR-01: email must be verified before full access
    is_verified     TINYINT(1)          NOT NULL DEFAULT 0,
    is_active       TINYINT(1)          NOT NULL DEFAULT 1,
    created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    -- Enforce unique emails — FR-01: "409 if email already registered"
    UNIQUE KEY uq_users_email (email),
    -- NFR Performance, Page 8: optimize role-based route guards
    KEY idx_users_role_verified (role, is_verified),
    KEY idx_users_is_active (is_active)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='User accounts — FR-01, FR-02 [SRS Section 3.1-3.2]';


-- ============================================================
-- TABLE: email_verification_tokens
-- FR-01: "verification email sent upon registration"
-- FR-01: token expiry enforced — prevent stale token reuse
-- SRS Page 5-6: Registration creates verification workflow
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED     NOT NULL,
    -- Cryptographically random UUID token [BP — crypto.randomUUID()]
    token       VARCHAR(255)        NOT NULL,
    -- FR-01: tokens expire — configurable via ENV EMAIL_VERIFICATION_TOKEN_TTL
    expires_at  DATETIME            NOT NULL,
    -- Prevent token reuse after consumption
    used_at     DATETIME                NULL DEFAULT NULL,
    created_at  DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_evt_token (token),
    KEY idx_evt_user_id (user_id),
    -- NFR Performance: expiry lookup optimized [Page 8]
    KEY idx_evt_expires_used (expires_at, used_at),

    CONSTRAINT fk_evt_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Email verification tokens — FR-01 [SRS Page 5-6]';


-- ============================================================
-- TABLE: login_attempts
-- FR-02: Rate limiting — "5 attempts per 15-minute window per IP"
-- NFR Security, Page 8: brute-force protection
-- Complements express-rate-limit with persistent DB logging
-- ============================================================
CREATE TABLE IF NOT EXISTS login_attempts (
    id              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    -- Supports IPv4 (15 chars) and IPv6 (45 chars)
    ip_address      VARCHAR(45)         NOT NULL,
    -- Nullable: attacker may not provide valid email
    email           VARCHAR(255)            NULL,
    attempted_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    was_successful  TINYINT(1)          NOT NULL DEFAULT 0,

    PRIMARY KEY (id),
    -- FR-02: composite index for "COUNT(*) WHERE ip=? AND attempted_at > window"
    KEY idx_la_ip_window (ip_address, attempted_at),
    KEY idx_la_email_window (email, attempted_at)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Login rate limiting log — FR-02 [SRS Section 3.2, Page 6]';


-- ============================================================
-- TABLE: slots
-- FR-03: Slot creation — capacity, overlap prevention, soft delete
-- FR-04: Browse available slots — date/status indexed
-- FR-08: Admin schedule overview — booking_count, status
-- FR-09: Soft delete — deleted_at IS NULL = active
-- NFR Performance, Page 8: indexed on date, status
-- ============================================================
CREATE TABLE IF NOT EXISTS slots (
    id              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    title           VARCHAR(255)        NOT NULL
                        COMMENT 'Service name or slot description',
    date            DATE                NOT NULL,
    start_time      TIME                NOT NULL,
    end_time        TIME                NOT NULL,
    -- FR-03: configurable capacity per slot
    capacity        SMALLINT UNSIGNED   NOT NULL DEFAULT 1
                        COMMENT 'Max concurrent bookings [FR-03]',
    -- Denormalized counter: avoids COUNT() on bookings per FR-04 read performance
    booking_count   SMALLINT UNSIGNED   NOT NULL DEFAULT 0
                        COMMENT 'Current booking count — NFR Performance',
    status          ENUM('active','inactive')
                                        NOT NULL DEFAULT 'active',
    -- FR-03: recurring slots — "every Monday 09:00-12:00"
    is_recurring    TINYINT(1)          NOT NULL DEFAULT 0,
    recurrence_rule VARCHAR(255)            NULL
                        COMMENT 'e.g. RRULE:FREQ=WEEKLY;BYDAY=MO [FR-03]',
    recurrence_group_id BIGINT UNSIGNED     NULL
                        COMMENT 'Groups recurring series — FR-03',
    -- Audit: who created and when [FR-03: "records its creator, creation timestamp"]
    created_by      BIGINT UNSIGNED     NOT NULL,
    -- FR-09: soft delete — "marked as inactive rather than removed"
    deleted_at      DATETIME                NULL DEFAULT NULL,
    deleted_by      BIGINT UNSIGNED         NULL DEFAULT NULL,
    created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- FR-04: "served from a read-optimized query with indexed columns on date and status"
    KEY idx_slots_date_status (date, status),
    -- FR-03: overlap detection query — date + time range
    KEY idx_slots_date_times (date, start_time, end_time),
    -- FR-09: soft-delete filter
    KEY idx_slots_deleted_at (deleted_at),
    -- FR-08: admin overview filtered by status
    KEY idx_slots_status_date (status, date),
    KEY idx_slots_created_by (created_by),
    KEY idx_slots_recurrence_group (recurrence_group_id),

    CONSTRAINT fk_slots_created_by
        FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT fk_slots_deleted_by
        FOREIGN KEY (deleted_by) REFERENCES users (id),

    -- FR-03: end_time must be after start_time
    CONSTRAINT chk_slot_times
        CHECK (end_time > start_time),
    -- FR-03: capacity must be at least 1
    CONSTRAINT chk_slot_capacity
        CHECK (capacity >= 1),
    -- FR-05: booking_count cannot exceed capacity
    CONSTRAINT chk_slot_booking_count
        CHECK (booking_count <= capacity)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Time slots defined by admin — FR-03, FR-04, FR-08, FR-09';


-- ============================================================
-- TABLE: bookings
-- FR-05: Book appointment — locking, confirmation, timestamp
-- FR-06: Cancel — status transition, capacity restoration
-- FR-07: History — client and admin views
-- FR-09 Revised: cancelled_by supports admin mass-cancel
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
    id                      BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    -- FR-05: "booking record includes the client ID, slot ID, timestamp"
    client_id               BIGINT UNSIGNED     NOT NULL,
    slot_id                 BIGINT UNSIGNED     NOT NULL,
    -- FR-06: status transitions confirmed → cancelled
    status                  ENUM('confirmed','cancelled')
                                                NOT NULL DEFAULT 'confirmed',
    cancellation_reason     VARCHAR(500)            NULL,
    -- FR-06: "cancellation timestamp is recorded"
    cancelled_at            DATETIME               NULL DEFAULT NULL,
    -- FR-06: "Administrators may also cancel bookings on behalf of clients"
    cancelled_by            BIGINT UNSIGNED        NULL DEFAULT NULL,
    -- FR-05: "booking timestamp" — initial status 'confirmed'
    booked_at               DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- FR-07: client booking history — "filtering by status and date range"
    KEY idx_bookings_client_status (client_id, status),
    -- FR-05: slot capacity check and lock target
    KEY idx_bookings_slot_status (slot_id, status),
    -- FR-07: "reverse chronological order"
    KEY idx_bookings_booked_at (booked_at DESC),
    -- FR-08: admin all-bookings view with status filter
    KEY idx_bookings_status_booked (status, booked_at),

    -- Prevent a client from booking the same slot more than once [BP]
    UNIQUE KEY uq_bookings_client_slot (client_id, slot_id),

    CONSTRAINT fk_bookings_client
        FOREIGN KEY (client_id) REFERENCES users (id),
    CONSTRAINT fk_bookings_slot
        FOREIGN KEY (slot_id)   REFERENCES slots (id),
    CONSTRAINT fk_bookings_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES users (id)

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Appointment bookings — FR-05, FR-06, FR-07';


-- ============================================================
-- TABLE: refresh_tokens
-- FR-02: refresh token rotation for stateless auth
-- NFR Security, Page 8: "short-lived JWTs with refresh token rotation"
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED     NOT NULL,
    token_hash  VARCHAR(255)        NOT NULL
                    COMMENT 'SHA-256 hash of the refresh token — never store plaintext',
    expires_at  DATETIME            NOT NULL,
    revoked_at  DATETIME               NULL DEFAULT NULL,
    created_at  DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address  VARCHAR(45)             NULL,
    user_agent  VARCHAR(500)            NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_rt_token_hash (token_hash),
    KEY idx_rt_user_id (user_id),
    KEY idx_rt_expires (expires_at),

    CONSTRAINT fk_rt_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Refresh token store — FR-02, NFR Security [Page 8]';

-- ============================================================
-- TABLE: reminder_settings
-- FR-10 optional: admin-configurable reminder settings
-- ============================================================
CREATE TABLE IF NOT EXISTS reminder_settings (
    id              TINYINT UNSIGNED    NOT NULL DEFAULT 1,
    reminders_enabled TINYINT(1)        NOT NULL DEFAULT 0,
    reminder_hours  SMALLINT UNSIGNED   NOT NULL DEFAULT 24,
    updated_by      BIGINT UNSIGNED         NULL,
    updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_rs_enabled (reminders_enabled),

    CONSTRAINT fk_rs_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE SET NULL,
    CONSTRAINT chk_rs_singleton
        CHECK (id = 1),
    CONSTRAINT chk_rs_hours
        CHECK (reminder_hours IN (24, 48, 168))
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Singleton reminder settings row — FR-10 optional reminders';

-- ============================================================
-- TABLE: booking_reminder_log
-- FR-10 optional: dedupe and audit reminder sends
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_reminder_log (
    id              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    booking_id      BIGINT UNSIGNED     NOT NULL,
    reminder_hours  SMALLINT UNSIGNED   NOT NULL,
    scheduled_for   DATETIME            NOT NULL,
    sent_at         DATETIME                NULL DEFAULT NULL,
    error_message   TEXT                    NULL,
    created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_brl_booking_hours (booking_id, reminder_hours),
    KEY idx_brl_scheduled (scheduled_for),
    KEY idx_brl_sent_at (sent_at),

    CONSTRAINT fk_brl_booking
        FOREIGN KEY (booking_id) REFERENCES bookings (id)
        ON DELETE CASCADE,
    CONSTRAINT chk_brl_hours
        CHECK (reminder_hours IN (24, 48, 168))
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Reminder delivery log per booking and reminder window';


-- ============================================================
-- TABLE: email_notification_log
-- FR-10: "All email events (sent, failed, bounced) are logged"
-- FR-10: "retried up to 3 times with exponential backoff"
-- ============================================================
CREATE TABLE IF NOT EXISTS email_notification_log (
    id              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    recipient_id    BIGINT UNSIGNED         NULL,
    recipient_email VARCHAR(255)        NOT NULL,
    template_type   ENUM(
                        'registration_verification',
                         'booking_confirmation',
                         'booking_cancellation',
                         'slot_cancellation',
                         'appointment_reminder',
                         'account_locked'
                     )               NOT NULL,
    -- Foreign key to booking or slot for context
    related_id      BIGINT UNSIGNED     NULL,
    status          ENUM('queued','sent','failed','bounced')
                                    NOT NULL DEFAULT 'queued',
    -- FR-10: "retried up to 3 times"
    retry_count     TINYINT UNSIGNED    NOT NULL DEFAULT 0,
    sent_at         DATETIME               NULL DEFAULT NULL,
    error_message   TEXT                   NULL,
    created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_enl_status_retry (status, retry_count),
    KEY idx_enl_recipient (recipient_id),
    KEY idx_enl_template (template_type),

    CONSTRAINT fk_enl_recipient
        FOREIGN KEY (recipient_id) REFERENCES users (id)
        ON DELETE SET NULL

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Email event audit log — FR-10 [SRS Page 7-8]';

-- ============================================================
-- TABLE: in_app_notifications
-- FR-10 fallback: in-app notifications when email delivery fails
-- ============================================================
CREATE TABLE IF NOT EXISTS in_app_notifications (
    id          BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED     NOT NULL,
    type        VARCHAR(64)         NOT NULL,
    title       VARCHAR(255)        NOT NULL,
    message     TEXT                NOT NULL,
    payload     JSON                    NULL,
    created_at  DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at     DATETIME                NULL DEFAULT NULL,

    PRIMARY KEY (id),
    KEY idx_ian_user_created (user_id, created_at),
    KEY idx_ian_user_read (user_id, read_at),

    CONSTRAINT fk_ian_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='In-app notification fallback records — FR-10';


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Seed: Default Admin Account
-- Password is 'ChangeMe123!' — MUST be changed post-deployment
-- Hash generated with: bcrypt.hash('ChangeMe123!', 12)
-- ============================================================
INSERT IGNORE INTO users (full_name, email, password_hash, role, is_verified)
VALUES (
    'System Administrator',
    'admin@yourdomain.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/8aLPEJrKa',
    'admin',
    1
);

INSERT IGNORE INTO reminder_settings (id, reminders_enabled, reminder_hours, updated_by)
VALUES (1, 0, 24, NULL);

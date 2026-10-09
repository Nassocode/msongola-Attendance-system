CREATE DATABASE IF NOT EXISTS msongola_attendance
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE msongola_attendance;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'teacher', 'academic_master') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS class_teachers (
  class_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, teacher_id),
  CONSTRAINT fk_class_teachers_class FOREIGN KEY (class_id) REFERENCES classes(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_class_teachers_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_class_teachers_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_class_teachers_teacher (teacher_id, class_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_number VARCHAR(40) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  INDEX idx_students_class (class_id, is_active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guardian_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_guardians (
  student_id BIGINT UNSIGNED NOT NULL,
  guardian_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (student_id, guardian_id),
  CONSTRAINT fk_student_guardians_student FOREIGN KEY (student_id) REFERENCES students(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_student_guardians_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_contacts(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_student_guardians_guardian (guardian_id, student_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('present', 'absent', 'sick', 'late', 'excused') NOT NULL,
  marked_by BIGINT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_attendance_marker FOREIGN KEY (marked_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE KEY uq_attendance_student_date (student_id, attendance_date),
  INDEX idx_attendance_date (attendance_date, student_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  class_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  student_count INT UNSIGNED NOT NULL,
  approval_status ENUM('pending', 'approved', 'returned') NOT NULL DEFAULT 'pending',
  review_notes VARCHAR(500) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_submissions_class FOREIGN KEY (class_id) REFERENCES classes(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_attendance_submissions_submitter FOREIGN KEY (submitted_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_submissions_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  UNIQUE KEY uq_attendance_submission_class_date (class_id, attendance_date),
  INDEX idx_attendance_submissions_date (attendance_date, class_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  class_id BIGINT UNSIGNED NULL,
  related_date DATE NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_user_notifications_class FOREIGN KEY (class_id) REFERENCES classes(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uq_user_notification (user_id, notification_type, class_id, related_date),
  INDEX idx_user_notifications_user_date (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS monthly_sms_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  guardian_id BIGINT UNSIGNED NOT NULL,
  report_month DATE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('sending', 'sent', 'failed') NOT NULL DEFAULT 'sending',
  provider_message_id VARCHAR(120) NULL,
  error_message VARCHAR(500) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 1,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_monthly_sms_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_contacts(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uq_monthly_sms_guardian_month (guardian_id, report_month),
  INDEX idx_monthly_sms_status (report_month, status)
) ENGINE=InnoDB;

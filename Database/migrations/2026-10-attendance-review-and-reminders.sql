USE msongola_attendance;

ALTER TABLE attendance_submissions
  ADD COLUMN approval_status ENUM('pending', 'approved', 'returned') NOT NULL DEFAULT 'pending' AFTER student_count,
  ADD COLUMN review_notes VARCHAR(500) NULL AFTER approval_status,
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL AFTER review_notes,
  ADD COLUMN reviewed_at TIMESTAMP NULL AFTER reviewed_by,
  ADD CONSTRAINT fk_attendance_submissions_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE user_notifications (
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

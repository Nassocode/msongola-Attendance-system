USE msongola_attendance;

ALTER TABLE attendance_records
  MODIFY status ENUM('present', 'absent', 'sick', 'late', 'excused') NOT NULL;

CREATE TABLE attendance_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  class_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  student_count INT UNSIGNED NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_submissions_class FOREIGN KEY (class_id) REFERENCES classes(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_attendance_submissions_submitter FOREIGN KEY (submitted_by) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE KEY uq_attendance_submission_class_date (class_id, attendance_date),
  INDEX idx_attendance_submissions_date (attendance_date, class_id)
) ENGINE=InnoDB;

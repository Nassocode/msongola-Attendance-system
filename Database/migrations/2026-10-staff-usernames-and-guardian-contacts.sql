USE msongola_attendance;

ALTER TABLE users
  ADD COLUMN username VARCHAR(50) NULL AFTER full_name;

UPDATE users
SET username = CONCAT(role, id)
WHERE username IS NULL;

ALTER TABLE users
  MODIFY username VARCHAR(50) NOT NULL,
  ADD UNIQUE KEY uq_users_username (username);

CREATE TABLE guardian_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE student_guardians (
  student_id BIGINT UNSIGNED NOT NULL,
  guardian_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (student_id, guardian_id),
  CONSTRAINT fk_student_guardians_student FOREIGN KEY (student_id) REFERENCES students(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_student_guardians_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_contacts(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX idx_student_guardians_guardian (guardian_id, student_id)
) ENGINE=InnoDB;

INSERT INTO guardian_contacts (id, full_name, phone)
SELECT id, full_name, phone
FROM users
WHERE role = 'parent';

INSERT INTO student_guardians (student_id, guardian_id)
SELECT student_id, parent_id
FROM student_parents;

ALTER TABLE monthly_sms_logs
  DROP FOREIGN KEY fk_monthly_sms_parent,
  CHANGE parent_id guardian_id BIGINT UNSIGNED NOT NULL,
  DROP INDEX uq_monthly_sms_parent_month,
  ADD UNIQUE KEY uq_monthly_sms_guardian_month (guardian_id, report_month),
  ADD CONSTRAINT fk_monthly_sms_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_contacts(id)
    ON UPDATE CASCADE ON DELETE CASCADE;

DELETE FROM monthly_sms_logs
WHERE guardian_id NOT IN (SELECT id FROM guardian_contacts);

DELETE FROM users
WHERE role = 'parent';

DROP TABLE student_parents;

ALTER TABLE users
  MODIFY role ENUM('admin', 'teacher') NOT NULL;

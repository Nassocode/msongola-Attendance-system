USE msongola_attendance;

ALTER TABLE users
  MODIFY role ENUM('admin', 'teacher', 'academic_master') NOT NULL;

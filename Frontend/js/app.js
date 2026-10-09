const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const dashboardView = $('#dashboard-view');
const notice = $('#notice');
const attendanceStatuses = ['present', 'absent', 'sick'];
let currentUser = null;
let loadedStudents = [];
let loadedClassId = '';
let loadedAttendanceDate = '';
let monthlyReportStudents = [];
let monthlyReportRequest = 0;
let directoryClasses = [];
let directoryStudents = [];
let staffAccounts = [];

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
}

function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
}

function enforcePasswordByteLimit(input) {
  const updateValidity = () => {
    const exceedsLimit = new TextEncoder().encode(input.value).length > 72;
    input.setCustomValidity(exceedsLimit ? 'Password must not exceed 72 UTF-8 bytes.' : '');
  };
  input.addEventListener('input', updateValidity);
  updateValidity();
}

const teacherPasswordInput = $('#teacher-form [name="password"]');
const academicMasterPasswordInput = $('#academic-master-form [name="password"]');
const staffAccountPasswordInput = $('#staff-account-edit-form [name="password"]');
const currentPasswordInput = $('#password-form [name="currentPassword"]');
const newPasswordInput = $('#password-form [name="newPassword"]');
enforcePasswordByteLimit(teacherPasswordInput);
enforcePasswordByteLimit(academicMasterPasswordInput);
enforcePasswordByteLimit(staffAccountPasswordInput);
enforcePasswordByteLimit(newPasswordInput);

function validatePasswordChange() {
  if (newPasswordInput.validity.customError) return;
  newPasswordInput.setCustomValidity(
    currentPasswordInput.value && newPasswordInput.value === currentPasswordInput.value
      ? 'Choose a new password different from your current password.'
      : ''
  );
}

currentPasswordInput.addEventListener('input', validatePasswordChange);
newPasswordInput.addEventListener('input', validatePasswordChange);

function rosterMatchesSelection() {
  return loadedStudents.length > 0 &&
    loadedClassId === $('#attendance-class').value &&
    loadedAttendanceDate === $('#attendance-date').value;
}

function updateAttendanceProgress() {
  const selects = [...$('#roster').querySelectorAll('select[data-student-id]')];
  const counts = Object.fromEntries(attendanceStatuses.map((status) => [status, 0]));
  let unmarked = 0;
  let sickDetailsMissing = 0;
  selects.forEach((select) => {
    if (attendanceStatuses.includes(select.value)) {
      counts[select.value] += 1;
      if (select.value === 'sick' && !select.closest('.roster-row').querySelector('input[type="text"]').value.trim()) {
        sickDetailsMissing += 1;
      }
    } else {
      unmarked += 1;
    }
  });
  const total = selects.length;
  $('#attendance-progress').textContent = total
    ? `${total - unmarked} of ${total} students marked · Present ${counts.present} · Absent ${counts.absent} · Sick ${counts.sick}${unmarked ? ` · ${unmarked} remaining` : ''}${sickDetailsMissing ? ` · Add illness details for ${sickDetailsMissing} sick student(s)` : unmarked ? '' : ' · Complete register ready to submit'}`
    : '';
  $('#save-attendance').disabled = !rosterMatchesSelection() || unmarked > 0 || sickDetailsMissing > 0;
}

function invalidateRoster() {
  loadedStudents = [];
  loadedClassId = '';
  loadedAttendanceDate = '';
  $('#roster-tools').hidden = true;
  $('#roster-search').value = '';
  $('#roster').replaceChildren();
  const prompt = document.createElement('p');
  prompt.className = 'empty';
  prompt.textContent = 'Load a class register to record attendance.';
  $('#roster').append(prompt);
  $('#attendance-progress').textContent = '';
  $('#save-attendance').disabled = true;
}

function filterRoster(query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  $('#roster').querySelectorAll('.roster-row').forEach((row) => {
    row.hidden = normalizedQuery !== '' && !row.dataset.searchText.includes(normalizedQuery);
  });
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle('sidebar-open', isOpen);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(isOpen));
  $('#sidebar-toggle').setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  $('#sidebar-backdrop').hidden = !isOpen;
}

function updateSidebarActiveLink() {
  const links = [...document.querySelectorAll('.sidebar-link:not([hidden])')];
  const activePage = document.querySelector('.dashboard-page:not([hidden])');
  const activeLink = links.find((link) => link.hash === `#${activePage?.id}`) || links[0];
  links.forEach((link) => {
    const isActive = link === activeLink;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function setDashboardPage(scrollToTop = false) {
  if (!currentUser) return;
  const defaultPageId = currentUser.role === 'admin'
    ? 'admin-overview-page'
    : currentUser.role === 'academic_master'
      ? 'academic-attendance-review'
      : 'attendance-section';
  const pages = [...document.querySelectorAll('.dashboard-page[data-page-roles]')];
  const requestedPage = pages.find((page) =>
    page.id === window.location.hash.slice(1) &&
    page.dataset.pageRoles.split(',').includes(currentUser.role)
  );
  const activePage = requestedPage || pages.find((page) => page.id === defaultPageId);
  if (!activePage) {
    throw new Error(`No dashboard page is configured for the ${currentUser.role} role.`);
  }
  if (!requestedPage) {
    window.history.replaceState(null, '', `#${activePage.id}`);
  }
  pages.forEach((page) => {
    page.hidden = page !== activePage;
  });
  const pageHeadings = {
    'admin-overview-page': ['School dashboard', 'A quick overview of today and your school.'],
    'attendance-section': ['Attendance register', 'Load a class register to record or review attendance.'],
    'setup-section': ['Classes & students', 'Create classes, enroll students, and keep the school directory up to date.'],
    'team-section': ['Staff & teachers', 'Create staff accounts and assign teachers to their classes.'],
    'academic-attendance-review': ['Attendance review', 'Review submitted class registers and notes without changing records.'],
    'staff-report-card': ['Monthly attendance report', 'Filter, download, or print attendance summaries for a selected month.'],
    'sms-logs-card': ['Guardian SMS', 'Review monthly attendance messages sent to guardian phone numbers.'],
    'notifications-page': ['Notifications', 'Attendance reminders and Academic Office review updates for your account.'],
    'password-card': ['Account settings', 'Update your sign-in password to keep your account secure.'],
    'profile-page': ['My profile', 'View and update your staff account details.']
  };
  const [title, subtitle] = pageHeadings[activePage.id];
  $('#page-title').textContent = currentUser.role === 'teacher' && activePage.id === 'attendance-section'
    ? 'Attendance management'
    : title;
  $('#dashboard-subtitle').textContent = subtitle;
  updateSidebarActiveLink();
  if (activePage.id === 'notifications-page') {
    loadNotifications().catch((error) => showNotice(error.message, true));
  }
  if (scrollToTop) window.scrollTo({ top: 0, behavior: 'auto' });
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addCell(row, value, tag = 'td') {
  const cell = document.createElement(tag);
  cell.textContent = value === null || value === undefined ? '' : String(value);
  row.append(cell);
  return cell;
}

function renderReport(container, students) {
  container.replaceChildren();
  if (!students.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No attendance records were found for this month.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Student', 'Class', 'Present', 'Absent', 'Sick', 'Late', 'Excused', 'Days recorded'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  students.forEach((student) => {
    const row = body.insertRow();
    addCell(row, `${student.studentName} (${student.studentNumber})`);
    addCell(row, student.className);
    addCell(row, student.present);
    addCell(row, student.absent);
    addCell(row, student.sick);
    addCell(row, student.late);
    addCell(row, student.excused);
    addCell(row, student.total);
  });
  wrapper.append(table);
  container.append(wrapper);
}

function renderClassDirectory(classes) {
  const container = $('#class-directory');
  container.replaceChildren();
  if (!classes.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No classes have been created yet.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Class', 'Active students', 'Action'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  classes.forEach((item) => {
    const row = body.insertRow();
    addCell(row, item.name);
    addCell(row, Number(item.student_count).toLocaleString());
    const action = row.insertCell();
    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'button button-secondary';
    viewButton.textContent = 'View students';
    viewButton.addEventListener('click', () => {
      $('#directory-class-filter').value = String(item.id);
      renderStudentDirectory();
      $('#student-directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    action.append(viewButton);
  });
  wrapper.append(table);
  container.append(wrapper);
}

function renderStudentDirectory() {
  const container = $('#student-directory');
  const classId = $('#directory-class-filter').value;
  const query = $('#directory-student-search').value.trim().toLocaleLowerCase();
  const filteredStudents = directoryStudents.filter((student) => {
    const matchesClass = !classId || String(student.classId) === classId;
    const searchText = `${student.fullName} ${student.studentNumber}`.toLocaleLowerCase();
    return matchesClass && searchText.includes(query);
  });
  $('#student-directory-count').textContent = `Showing ${filteredStudents.length} of ${directoryStudents.length} active students.`;
  container.replaceChildren();
  if (!filteredStudents.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = directoryStudents.length
      ? 'No students match the selected class or search.'
      : 'No students have been enrolled yet.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Student number', 'Student name', 'Class'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  filteredStudents.forEach((student) => {
    const row = body.insertRow();
    addCell(row, student.studentNumber);
    addCell(row, student.fullName);
    addCell(row, student.className);
  });
  wrapper.append(table);
  container.append(wrapper);
}

function renderAcademicMasters(academicMasters) {
  const container = $('#academic-master-list');
  container.replaceChildren();
  if (!academicMasters.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No active academic master accounts yet.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Name', 'Username', 'Phone'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  academicMasters.forEach((academicMaster) => {
    const row = body.insertRow();
    addCell(row, academicMaster.fullName);
    addCell(row, academicMaster.username);
    addCell(row, academicMaster.phone);
  });
  wrapper.append(table);
  container.append(wrapper);
}

function renderStaffAccounts() {
  const container = $('#staff-account-list');
  container.replaceChildren();
  if (!staffAccounts.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No active teacher or academic master accounts yet.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Role', 'Name', 'Username', 'Phone', 'Action'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  staffAccounts.forEach((account) => {
    const row = body.insertRow();
    addCell(row, account.role === 'academic_master' ? 'Academic master' : 'Teacher');
    addCell(row, account.fullName);
    addCell(row, account.username);
    addCell(row, account.phone);
    const actionCell = row.insertCell();
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'button button-secondary';
    editButton.dataset.staffAccountId = account.id;
    editButton.textContent = 'Edit';
    actionCell.append(editButton);
  });
  wrapper.append(table);
  container.append(wrapper);
}

function renderAttendanceReview(records, date) {
  const container = $('#academic-attendance-results');
  const dailyRecords = records.filter((record) => record.attendanceDate === date);
  container.replaceChildren();
  if (!dailyRecords.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No class register has been submitted to the Academic Master office for this date.';
    container.append(empty);
    return;
  }
  const submission = dailyRecords[0];
  const summary = document.createElement('p');
  summary.className = 'attendance-submission-summary';
  summary.setAttribute('role', 'status');
  if (submission.submittedAt) {
    const statusLabel = {
      pending: 'Awaiting review',
      returned: 'Returned to teacher',
      approved: 'Approved'
    }[submission.approvalStatus] || 'Awaiting review';
    summary.textContent = `Submitted by ${submission.submittedBy} · ${submission.submittedCount} students · ${statusLabel} · ${submission.submittedAt}`;
    if (submission.reviewNotes) {
      summary.textContent += ` · Review note: ${submission.reviewNotes}`;
    }
    if (submission.reviewedBy) {
      summary.textContent += ` · Reviewed by ${submission.reviewedBy}`;
    }
  } else {
    summary.textContent = 'These records predate the complete-class submission workflow and have no submission receipt.';
    summary.classList.add('attendance-submission-legacy');
  }
  container.append(summary);
  if (submission.submissionId && submission.approvalStatus !== 'approved') {
    const form = document.createElement('form');
    form.className = 'attendance-review-actions';
    form.dataset.submissionId = submission.submissionId;
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Return note (required when returning)';
    const notes = document.createElement('textarea');
    notes.name = 'notes';
    notes.maxLength = 500;
    notes.rows = 2;
    notes.value = submission.approvalStatus === 'returned' ? submission.reviewNotes || '' : '';
    notesLabel.append(notes);
    const approve = document.createElement('button');
    approve.type = 'submit';
    approve.className = 'button';
    approve.dataset.reviewDecision = 'approved';
    approve.textContent = 'Approve register';
    const sendBack = document.createElement('button');
    sendBack.type = 'submit';
    sendBack.className = 'button button-secondary';
    sendBack.dataset.reviewDecision = 'returned';
    sendBack.textContent = 'Return for correction';
    form.append(notesLabel, approve, sendBack);
    container.append(form);
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Student number', 'Student', 'Class', 'Status', 'Note'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  dailyRecords.forEach((record) => {
    const row = body.insertRow();
    addCell(row, record.studentNumber);
    addCell(row, record.studentName);
    addCell(row, record.className);
    addCell(row, record.status[0].toUpperCase() + record.status.slice(1));
    addCell(row, record.notes || '—');
  });
  wrapper.append(table);
  container.append(wrapper);
}

async function loadNotifications() {
  const container = $('#notification-list');
  if (!container) return;
  container.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Loading notifications…';
  container.append(loading);
  const { unreadCount, notifications } = await window.api.get('/notifications');
  const count = $('#notification-count');
  count.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  count.hidden = unreadCount === 0;
  container.replaceChildren();
  if (!notifications.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'You have no notifications.';
    container.append(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'notification-list';
  notifications.forEach((notification) => {
    const item = document.createElement('li');
    item.className = 'notification-item';
    item.classList.toggle('notification-unread', !notification.readAt);
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = notification.title;
    const message = document.createElement('p');
    message.textContent = notification.message;
    const meta = document.createElement('small');
    meta.textContent = [notification.className, notification.relatedDate, notification.createdAt]
      .filter(Boolean)
      .join(' · ');
    content.append(title, message, meta);
    item.append(content);
    if (!notification.readAt) {
      const markRead = document.createElement('button');
      markRead.type = 'button';
      markRead.className = 'button button-quiet';
      markRead.dataset.notificationId = notification.id;
      markRead.textContent = 'Mark as read';
      item.append(markRead);
    }
    list.append(item);
  });
  container.append(list);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadMonthlyReport() {
  if (!monthlyReportStudents.length) return;
  const rows = [
    ['Student name', 'Student number', 'Class', 'Present', 'Absent', 'Sick', 'Late', 'Excused', 'Days recorded'],
    ...monthlyReportStudents.map((student) => [
      student.studentName,
      student.studentNumber,
      student.className,
      student.present,
      student.absent,
      student.sick,
      student.late,
      student.excused,
      student.total
    ])
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  const className = $('#report-class-filter').selectedOptions[0]?.textContent;
  const classSuffix = $('#report-class-filter').value && className
    ? `-${className.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  link.download = `attendance-report-${$('#staff-report-month').value}${classSuffix}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function printMonthlyReport() {
  if (!monthlyReportStudents.length) return;
  document.body.classList.add('printing-report');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-report');
});

function renderSmsLogs(container, logs) {
  container.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No SMS attempts for this month.';
    container.append(empty);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  ['Guardian', 'Phone', 'Status', 'Attempts', 'Sent', 'Last error', 'Action'].forEach((label) => addCell(head, label, 'th'));
  const body = table.createTBody();
  logs.forEach((log) => {
    const row = body.insertRow();
    addCell(row, log.guardianName);
    addCell(row, log.phone);
    addCell(row, log.status);
    addCell(row, log.attempts);
    addCell(row, log.sentAt || '—');
    addCell(row, log.errorMessage || '—');
    const action = row.insertCell();
    if (log.status === 'failed') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button button-secondary';
      retry.textContent = 'Retry';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          await window.api.post(`/admin/sms-logs/${encodeURIComponent(log.id)}/retry`, {});
          showNotice(`SMS resent to ${log.guardianName}.`);
          await loadSmsLogs($('#sms-log-month').value);
        } catch (error) {
          showNotice(error.message, true);
          retry.disabled = false;
        }
      });
      action.append(retry);
    } else {
      action.textContent = '—';
    }
  });
  wrapper.append(table);
  container.append(wrapper);
}

async function loadClasses() {
  const { classes } = await window.api.get('/classes');
  directoryClasses = classes;
  const selectors = [$('#attendance-class'), $('#report-class-filter')];
  if (currentUser.role === 'admin') {
    selectors.push($('#student-class'), $('#assignment-class'), $('#directory-class-filter'));
  } else if (currentUser.role === 'academic_master') {
    selectors.push($('#academic-attendance-class'));
  }
  for (const selector of selectors) {
    const selectedValue = selector.value;
    selector.replaceChildren();
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = ['directory-class-filter', 'report-class-filter'].includes(selector.id) ? 'All classes' : 'Choose a class';
    selector.append(prompt);
    classes.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      selector.append(option);
    });
    if (classes.some((item) => String(item.id) === selectedValue)) selector.value = selectedValue;
  }
  if (currentUser.role === 'admin') {
    renderClassDirectory(classes);
    renderStudentDirectory();
  }
}

async function loadDirectoryStudents() {
  const container = $('#student-directory');
  container.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Loading student directory…';
  container.append(loading);
  try {
    const { students } = await window.api.get('/students');
    directoryStudents = students;
    renderStudentDirectory();
  } catch (error) {
    directoryStudents = [];
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'The student directory could not be loaded. Please try again.';
    container.replaceChildren(message);
    throw error;
  }
}

async function loadTeachers() {
  const { teachers } = await window.api.get('/admin/teachers');
  staffAccounts = staffAccounts.filter((account) => account.role !== 'teacher')
    .concat(teachers.map((teacher) => ({ ...teacher, role: 'teacher' })));
  const selector = $('#assignment-teacher');
  selector.replaceChildren();
  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Choose a teacher';
  selector.append(prompt);
  teachers.forEach((teacher) => {
    const option = document.createElement('option');
    option.value = teacher.id;
    option.textContent = `${teacher.username} — ${teacher.fullName} (${teacher.classIds.length} classes)`;
    selector.append(option);
  });
  renderStaffAccounts();
}

async function loadAcademicMasters() {
  const { academicMasters } = await window.api.get('/admin/academic-masters');
  renderAcademicMasters(academicMasters);
  staffAccounts = staffAccounts.filter((account) => account.role !== 'academic_master')
    .concat(academicMasters.map((academicMaster) => ({ ...academicMaster, role: 'academic_master' })));
  renderStaffAccounts();
}

async function loadAttendanceReview(classId, date) {
  const container = $('#academic-attendance-results');
  container.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Loading attendance review…';
  container.append(loading);
  try {
    const month = date.slice(0, 7);
    const { records } = await window.api.get(`/attendance?month=${encodeURIComponent(month)}&classId=${encodeURIComponent(classId)}`);
    renderAttendanceReview(records, date);
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'Attendance could not be loaded. Please try again.';
    container.replaceChildren(message);
    throw error;
  }
}

async function loadRoster(classId, date) {
  const roster = $('#roster');
  const filter = $('#attendance-filter');
  const filterButton = filter.querySelector('button[type="submit"]');
  const classSelector = $('#attendance-class');
  const dateInput = $('#attendance-date');
  const saveButton = $('#save-attendance');

  loadedStudents = [];
  loadedClassId = '';
  loadedAttendanceDate = '';
  saveButton.disabled = true;
  $('#roster-tools').hidden = true;
  $('#roster-search').value = '';
  $('#attendance-progress').textContent = '';
  roster.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Loading class register…';
  roster.append(loading);

  filterButton.disabled = true;
  classSelector.disabled = true;
  dateInput.disabled = true;
  const originalButtonText = filterButton.textContent;
  filterButton.textContent = 'Loading…';

  try {
    const { students } = await window.api.get(`/students?classId=${encodeURIComponent(classId)}`);
    const month = date.slice(0, 7);
    const { records } = await window.api.get(`/attendance?month=${encodeURIComponent(month)}&classId=${encodeURIComponent(classId)}`);
    const existing = new Map(records
      .filter((record) => record.attendanceDate === date)
      .map((record) => [Number(record.studentId), record]));
    loadedStudents = students;
    loadedClassId = classId;
    loadedAttendanceDate = date;
    roster.replaceChildren();

    if (!students.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No students are enrolled in this class yet.';
      roster.append(empty);
    }
    students.forEach((student) => {
      const row = document.createElement('div');
      row.className = 'roster-row';
      row.dataset.searchText = `${student.fullName} ${student.studentNumber}`.toLocaleLowerCase();
      const name = document.createElement('div');
      name.className = 'roster-name';
      const fullName = document.createElement('strong');
      fullName.textContent = student.fullName;
      const number = document.createElement('small');
      number.textContent = student.studentNumber;
      name.append(fullName, number);
      const select = document.createElement('select');
      select.dataset.studentId = student.id;
      select.setAttribute('aria-label', `Attendance status for ${student.fullName}`);
      select.required = true;
      const prompt = document.createElement('option');
      prompt.value = '';
      prompt.textContent = 'Select status';
      select.append(prompt);
      attendanceStatuses.forEach((status) => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = ({
          present: 'Present — Yupo',
          absent: 'Absent — Hayupo',
          sick: 'Sick — Mgonjwa'
        })[status];
        select.append(option);
      });
      const attendanceRecord = existing.get(Number(student.id));
      select.value = attendanceRecord?.status || '';
      const notes = document.createElement('input');
      notes.type = 'text';
      notes.maxLength = 500;
      notes.value = attendanceRecord?.notes || '';
      notes.placeholder = 'Add illness details if sick';
      notes.setAttribute('aria-label', `Illness details or note for ${student.fullName}`);
      const notesHelp = document.createElement('small');
      notesHelp.className = 'roster-notes-help';
      notesHelp.textContent = 'Explain the illness (required).';
      notesHelp.hidden = true;
      const notesField = document.createElement('div');
      notesField.className = 'roster-notes';
      notesField.append(notes, notesHelp);
      const updateSickDetails = () => {
        const isSick = select.value === 'sick';
        notes.required = isSick;
        notes.setAttribute('aria-required', String(isSick));
        notesHelp.hidden = !isSick;
        updateAttendanceProgress();
      };
      select.addEventListener('change', updateSickDetails);
      notes.addEventListener('input', updateAttendanceProgress);
      row.append(name, select, notesField);
      updateSickDetails();
      roster.append(row);
    });
    $('#roster-tools').hidden = students.length === 0;
    updateAttendanceProgress();
  } catch (error) {
    roster.replaceChildren();
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'The class register could not be loaded. Check your connection and try again.';
    roster.append(message);
    throw error;
  } finally {
    filterButton.disabled = false;
    classSelector.disabled = false;
    dateInput.disabled = false;
    filterButton.textContent = originalButtonText;
  }
}

async function loadMonthlyReport(month, container, classId = $('#report-class-filter').value) {
  const request = ++monthlyReportRequest;
  monthlyReportStudents = [];
  $('#export-report').disabled = true;
  $('#print-report').disabled = true;
  $('#print-report-month').textContent = month;
  const selectedClass = directoryClasses.find((item) => String(item.id) === classId);
  $('#print-report-class').textContent = selectedClass?.name || 'All classes';
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Loading monthly report…';
  container.replaceChildren(loading);
  try {
    const classQuery = classId ? `&classId=${encodeURIComponent(classId)}` : '';
    const { students } = await window.api.get(`/reports/monthly?month=${encodeURIComponent(month)}${classQuery}`);
    if (request !== monthlyReportRequest) return;
    monthlyReportStudents = students;
    renderReport(container, students);
    $('#export-report').disabled = students.length === 0;
    $('#print-report').disabled = students.length === 0;
  } catch (error) {
    if (request !== monthlyReportRequest) return;
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'The monthly report could not be loaded. Please try again.';
    container.replaceChildren(message);
    throw error;
  }
}

async function loadSmsLogs(month) {
  const { logs } = await window.api.get(`/admin/sms-logs?month=${encodeURIComponent(month)}`);
  renderSmsLogs($('#sms-logs'), logs);
}

async function loadAdminOverview() {
  const { overview } = await window.api.get('/admin/overview');
  $('#stat-students').textContent = Number(overview.students).toLocaleString();
  $('#stat-classes').textContent = Number(overview.classes).toLocaleString();
  $('#stat-teachers').textContent = Number(overview.teachers).toLocaleString();
  const students = Number(overview.students);
  const attendanceToday = Number(overview.attendanceToday);
  const attendanceCoverage = students > 0
    ? Math.min(100, Math.round((attendanceToday / students) * 100))
    : 0;
  $('#stat-attendance').textContent = attendanceToday.toLocaleString();
  $('#attendance-coverage').value = attendanceCoverage;
  $('#attendance-coverage').textContent = `${attendanceCoverage}%`;
  $('#attendance-coverage').setAttribute('aria-valuetext', `${attendanceCoverage}% recorded`);
  $('#attendance-coverage-label').textContent = students > 0
    ? `${attendanceToday.toLocaleString()} of ${students.toLocaleString()} enrolled students recorded`
    : 'No students enrolled yet.';
}

function updateAttendanceForSelection() {
  if (loadedStudents.length) invalidateRoster();
}

async function refreshDashboard() {
  clearNotice();
  const isAdmin = currentUser.role === 'admin';
  const isTeacher = currentUser.role === 'teacher';
  const isAcademicMaster = currentUser.role === 'academic_master';
  loginView.hidden = true;
  document.body.classList.remove('auth-page');
  document.body.classList.toggle('admin-dashboard', isAdmin);
  document.body.classList.toggle('teacher-dashboard', isTeacher);
  document.body.classList.toggle('academic-master-dashboard', isAcademicMaster);
  dashboardView.hidden = false;
  $('#account').hidden = false;
  $('#account-name').textContent = currentUser.fullName;
  $('#sidebar-name').textContent = currentUser.fullName;
  $('#sidebar-role').textContent = currentUser.role === 'academic_master'
    ? 'Academic master'
    : currentUser.role[0].toUpperCase() + currentUser.role.slice(1);
  $('#sidebar-avatar').textContent = currentUser.fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  $('#profile-avatar').textContent = $('#sidebar-avatar').textContent;
  $('#profile-display-name').textContent = currentUser.fullName;
  $('#profile-role').textContent = currentUser.role === 'academic_master'
    ? 'Academic master'
    : currentUser.role === 'admin'
      ? 'School administrator'
      : 'Teacher';
  $('#profile-form').elements.fullName.value = currentUser.fullName;
  $('#profile-form').elements.username.value = currentUser.username;
  $('#profile-form').elements.phone.value = currentUser.phone;
  $('#sidebar-workspace').textContent = isAdmin
    ? 'School workspace'
    : isAcademicMaster
      ? 'Academic workspace'
      : 'Teaching workspace';
  document.querySelectorAll('.sidebar-link[data-sidebar-role]').forEach((link) => {
    link.hidden = !link.dataset.sidebarRole.split(',').includes(currentUser.role);
  });
  $('#role-label').textContent = isAcademicMaster
    ? 'Academic master'
    : `${currentUser.role} portal`;
  $('#page-title').textContent = isAdmin
    ? 'School dashboard'
    : isAcademicMaster
      ? 'Academic oversight'
      : 'Attendance management';
  $('#dashboard-subtitle').textContent = isAdmin
    ? 'Manage daily attendance, school records, staff access, and guardian SMS updates.'
    : isAcademicMaster
      ? 'Review submitted attendance and follow monthly school attendance reports.'
      : 'View your assigned classes and update the daily attendance register.';
  $('#today-label').textContent = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());
  $('#admin-overview').hidden = !isAdmin;
  $('#admin-welcome').hidden = !isAdmin;
  $('#admin-welcome-name').textContent = currentUser.fullName.trim();
  $('#teacher-welcome').hidden = !isTeacher;
  $('#teacher-welcome-name').textContent = currentUser.fullName.trim();
  $('#academic-welcome').hidden = !isAcademicMaster;
  $('#academic-welcome-name').textContent = currentUser.fullName.trim();
  $('#staff-view').hidden = isAcademicMaster;
  $('#academic-view').hidden = !isAcademicMaster;
  $('#staff-report-card').hidden = false;
  $('#staff-report-card').querySelector('h2').textContent = isAcademicMaster ? 'School monthly attendance report' : 'Monthly summary';
  $('#setup-section').hidden = !isAdmin;
  $('#team-section').hidden = !isAdmin;
  $('#class-card').hidden = !isAdmin;
  $('#student-card').hidden = !isAdmin;
  $('#teacher-card').hidden = !isAdmin;
  $('#sms-logs-card').hidden = !isAdmin;
  $('#assignment-card').hidden = !isAdmin;
  const month = currentMonth();
  $('#attendance-date').value = currentDate();
  $('#attendance-date').max = currentDate();
  $('#staff-report-month').value = month;
  $('#sms-log-month').value = month;
  $('#academic-attendance-date').value = currentDate();
  $('#academic-attendance-date').max = currentDate();
  setDashboardPage();

  await loadClasses();
  if (isAdmin) await loadDirectoryStudents();
  await loadMonthlyReport(month, $('#staff-report'));
  if (isAdmin) {
    await loadAdminOverview();
    await loadTeachers();
    await loadAcademicMasters();
    await loadSmsLogs(month);
  }
  try {
    await loadNotifications();
  } catch (error) {
    showNotice(`Dashboard loaded, but notifications could not be refreshed: ${error.message}`, true);
  }
}

async function handleSubmit(form, action, successMessage) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await action();
    form.reset();
    showNotice(successMessage);
    return true;
  } catch (error) {
    showNotice(error.message, true);
    return false;
  } finally {
    button.disabled = false;
  }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const originalButtonText = button.textContent;
  button.textContent = 'Signing in…';
  const fields = Object.fromEntries(new FormData(form));
  try {
    const result = await window.api.post('/auth/login', fields);
    currentUser = result.user;
    form.reset();
    await refreshDashboard();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = originalButtonText;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try {
    await window.api.post('/auth/logout', {});
    currentUser = null;
    setSidebarOpen(false);
    dashboardView.hidden = true;
    $('#account').hidden = true;
    $('#password-card').hidden = true;
    loginView.hidden = false;
    document.body.classList.add('auth-page');
    document.body.classList.remove('admin-dashboard', 'teacher-dashboard', 'academic-master-dashboard');
    clearNotice();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#password-toggle').addEventListener('click', () => {
  if (window.location.hash !== '#password-card') {
    window.history.pushState(null, '', '#password-card');
  }
  setDashboardPage(true);
});

$('#sidebar-toggle').addEventListener('click', () => {
  setSidebarOpen(!document.body.classList.contains('sidebar-open'));
});

$('#sidebar-close').addEventListener('click', () => setSidebarOpen(false));

$('#sidebar-backdrop').addEventListener('click', () => setSidebarOpen(false));

document.querySelectorAll('.sidebar-link, .admin-quick-links a').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (window.location.hash !== link.hash) {
      window.history.pushState(null, '', link.hash);
    }
    setDashboardPage(true);
    setSidebarOpen(false);
  });
});

window.addEventListener('hashchange', () => setDashboardPage(true));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSidebarOpen(false);
});

$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  validatePasswordChange();
  if (!form.reportValidity()) return;
  const success = await handleSubmit(
    form,
    () => window.api.post('/auth/change-password', Object.fromEntries(new FormData(form))),
    'Password updated.'
  );
  if (success) {
    const defaultPageId = currentUser.role === 'admin'
      ? 'admin-overview-page'
      : currentUser.role === 'academic_master'
        ? 'academic-attendance-review'
        : 'attendance-section';
    window.history.pushState(null, '', `#${defaultPageId}`);
    setDashboardPage(true);
  }
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  try {
    const result = await window.api.patch('/auth/profile', fields);
    currentUser = result.user;
    $('#account-name').textContent = currentUser.fullName;
    $('#sidebar-name').textContent = currentUser.fullName;
    $('#sidebar-avatar').textContent = currentUser.fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    $('#profile-avatar').textContent = $('#sidebar-avatar').textContent;
    $('#profile-display-name').textContent = currentUser.fullName;
    showNotice('Your profile has been updated.');
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#profile-reset').addEventListener('click', () => {
  const form = $('#profile-form');
  form.elements.fullName.value = currentUser.fullName;
  form.elements.username.value = currentUser.username;
  form.elements.phone.value = currentUser.phone;
  clearNotice();
});

$('#attendance-filter').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadRoster($('#attendance-class').value, $('#attendance-date').value);
    clearNotice();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#attendance-class').addEventListener('change', updateAttendanceForSelection);

$('#attendance-date').addEventListener('change', updateAttendanceForSelection);

$('#roster-search').addEventListener('input', (event) => filterRoster(event.currentTarget.value));

$('#attendance-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!rosterMatchesSelection()) {
    showNotice('Load the register for the selected class and date before submitting.', true);
    return;
  }
  const records = [...$('#roster').querySelectorAll('select[data-student-id]')].map((select) => ({
    studentId: Number(select.dataset.studentId),
    status: select.value,
    notes: select.closest('.roster-row').querySelector('input[type="text"]').value.trim()
  }));
  if (records.some((record) => !attendanceStatuses.includes(record.status))) {
    showNotice('Choose an attendance status for every student before submitting.', true);
    return;
  }
  const button = $('#save-attendance');
  const controls = [...$('#attendance-form').querySelectorAll('select[data-student-id], input[type="text"]')];
  button.disabled = true;
  controls.forEach((control) => {
    control.disabled = true;
  });
  const originalButtonText = button.textContent;
  button.textContent = 'Submitting…';
  try {
    const result = await window.api.post('/attendance', {
      classId: Number($('#attendance-class').value),
      attendanceDate: $('#attendance-date').value,
      records
    });
    showNotice(`Complete register submitted to Academic Master office for ${result.submitted} students.`);
    try {
      await loadMonthlyReport($('#staff-report-month').value, $('#staff-report'));
      if (currentUser.role === 'admin') await loadAdminOverview();
    } catch (error) {
      showNotice(`Attendance was submitted successfully, but dashboard data could not be refreshed: ${error.message}`, true);
    }
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
    updateAttendanceProgress();
    button.textContent = originalButtonText;
  }
});

$('#class-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const ok = await handleSubmit(form, () => window.api.post('/classes', Object.fromEntries(new FormData(form))), 'Class created.');
    if (ok) {
      await loadClasses();
      await loadDirectoryStudents();
      await loadAdminOverview();
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#student-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  data.classId = Number(data.classId);
  try {
    const result = await handleSubmit(form, () => window.api.post('/students', data), 'Student enrolled. The guardian will receive monthly attendance summaries by SMS.');
    if (result) {
      await loadClasses();
      await loadDirectoryStudents();
      await loadAdminOverview();
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#teacher-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const success = await handleSubmit(form, () => window.api.post('/admin/teachers', Object.fromEntries(new FormData(form))), 'Teacher account created.');
    if (success) {
      await loadTeachers();
      await loadAdminOverview();
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const classId = $('#assignment-class').value;
  const teacherId = Number($('#assignment-teacher').value);
  try {
    const success = await handleSubmit(
      form,
      () => window.api.post(`/admin/classes/${encodeURIComponent(classId)}/teachers`, { teacherId }),
      'Teacher assigned to class.'
    );
    if (success) await loadTeachers();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#academic-master-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form));
  fields.phone = fields.phone.trim().replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(fields.phone)) {
    fields.phone = `+255${fields.phone.slice(1)}`;
  } else if (/^255\d{9}$/.test(fields.phone)) {
    fields.phone = `+${fields.phone}`;
  }
  try {
    const created = await handleSubmit(
      form,
      () => window.api.post('/admin/academic-masters', fields),
      'Academic master account created. They must sign in with the username and password you set.'
    );
    if (created) await loadAcademicMasters();
  } catch (error) {
    showNotice(error.message, true);
  }
});

function closeStaffAccountEditor() {
  const form = $('#staff-account-edit-form');
  form.hidden = true;
  form.reset();
  delete form.dataset.accountId;
}

$('#staff-account-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-staff-account-id]');
  if (!button) return;
  const account = staffAccounts.find((item) => item.id === Number(button.dataset.staffAccountId));
  if (!account) {
    showNotice('That staff account is no longer available. Refresh the list and try again.', true);
    return;
  }
  const form = $('#staff-account-edit-form');
  form.dataset.accountId = account.id;
  form.elements.username.value = account.username;
  form.elements.fullName.value = account.fullName;
  form.elements.phone.value = account.phone;
  form.elements.password.value = '';
  $('#staff-account-edit-title').textContent = `Edit ${account.role === 'academic_master' ? 'academic master' : 'teacher'} account`;
  form.hidden = false;
  form.elements.username.focus();
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#staff-account-edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const accountId = form.dataset.accountId;
  if (!accountId) {
    showNotice('Select a staff account before saving changes.', true);
    return;
  }
  const fields = Object.fromEntries(new FormData(form));
  if (!fields.password) delete fields.password;
  try {
    const success = await handleSubmit(
      form,
      () => window.api.put(`/admin/staff/${encodeURIComponent(accountId)}`, fields),
      'Staff account updated.'
    );
    if (success) {
      closeStaffAccountEditor();
      await Promise.all([loadTeachers(), loadAcademicMasters()]);
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#staff-account-edit-cancel').addEventListener('click', closeStaffAccountEditor);

let academicMasterValidationNoticeShown = false;

$('#academic-master-form').addEventListener('invalid', (event) => {
  if (academicMasterValidationNoticeShown) return;
  academicMasterValidationNoticeShown = true;
  const input = event.target;
  if (input instanceof HTMLInputElement) {
    const fieldName = input.labels?.[0]?.textContent.trim() || input.name;
    showNotice(`${fieldName}: ${input.validationMessage}`, true);
  }
  window.setTimeout(() => {
    academicMasterValidationNoticeShown = false;
  }, 0);
}, true);

$('#attendance-review-filter').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadAttendanceReview($('#academic-attendance-class').value, $('#academic-attendance-date').value);
    clearNotice();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#academic-attendance-results').addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-submission-id]');
  if (!form) return;
  event.preventDefault();
  const decision = event.submitter?.dataset.reviewDecision;
  const notes = form.elements.notes.value.trim();
  if (!['approved', 'returned'].includes(decision)) {
    showNotice('Choose whether to approve the register or return it for correction.', true);
    return;
  }
  if (decision === 'returned' && !notes) {
    form.elements.notes.setCustomValidity('Add a note explaining what the teacher needs to correct.');
    form.elements.notes.reportValidity();
    return;
  }
  form.elements.notes.setCustomValidity('');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await window.api.post(`/attendance/${encodeURIComponent(form.dataset.submissionId)}/review`, {
      decision,
      notes
    });
    showNotice(decision === 'approved' ? 'Attendance register approved.' : 'Attendance register returned to the teacher.');
    await loadAttendanceReview($('#academic-attendance-class').value, $('#academic-attendance-date').value);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
});

$('#academic-attendance-results').addEventListener('input', (event) => {
  if (event.target.name === 'notes') event.target.setCustomValidity('');
});

$('#notification-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-notification-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await window.api.patch(`/notifications/${encodeURIComponent(button.dataset.notificationId)}/read`, {});
    await loadNotifications();
  } catch (error) {
    button.disabled = false;
    showNotice(error.message, true);
  }
});

$('#refresh-notifications').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await loadNotifications();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#staff-report-month').addEventListener('change', async (event) => {
  try {
    await loadMonthlyReport(event.currentTarget.value, $('#staff-report'));
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#report-class-filter').addEventListener('change', async () => {
  try {
    await loadMonthlyReport($('#staff-report-month').value, $('#staff-report'));
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#export-report').addEventListener('click', downloadMonthlyReport);

$('#print-report').addEventListener('click', printMonthlyReport);

$('#sms-log-month').addEventListener('change', async (event) => {
  try {
    await loadSmsLogs(event.currentTarget.value);
  } catch (error) {
    showNotice(error.message, true);
  }
});

$('#directory-class-filter').addEventListener('change', renderStudentDirectory);
$('#directory-student-search').addEventListener('input', renderStudentDirectory);
$('#refresh-directory').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await loadClasses();
    await loadDirectoryStudents();
    showNotice('Class and student directory refreshed.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

window.api.get('/auth/me')
  .then(async ({ user }) => {
    currentUser = user;
    await refreshDashboard();
  })
  .catch((error) => {
    if (error.status !== 401) {
      showNotice(error.message, true);
    }
  });
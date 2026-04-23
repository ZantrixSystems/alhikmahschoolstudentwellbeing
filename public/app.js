const state = {
  bootstrap: null,
  route: {},
};

function setStatus(text) {
  document.getElementById("globalStatus").textContent = text;
}

function showMessage(text, mode) {
  const el = document.getElementById("appMessage");
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.textContent = text;
  el.style.borderColor = mode === "error" ? "rgba(179,63,63,0.2)" : "var(--line)";
}

async function callServer(path, options = {}) {
  setStatus("Loading");
  const url = new URL(path, window.location.origin);
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
    },
    body: options.payload ? JSON.stringify(options.payload) : undefined,
    credentials: "same-origin",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    setStatus("Error");
    showMessage(payload.error || "Something went wrong", "error");
    throw new Error(payload.error || "Request failed");
  }

  setStatus("Ready");
  return payload;
}

function parseRoute() {
  const url = new URL(window.location.href);
  state.route = {
    page: url.searchParams.get("page") || "dashboard",
    studentId: url.searchParams.get("studentId") || "",
    q: url.searchParams.get("q") || "",
    filter: url.searchParams.get("filter") || "",
    settingsTab: url.searchParams.get("settingsTab") || "users",
  };
}

function updateRoute(next) {
  const url = new URL(window.location.href);
  Object.entries(next).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });
  window.history.pushState({}, "", url.toString());
  parseRoute();
  renderRoute();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function renderFilterChips(expression) {
  if (!expression) return '<span class="muted small">No structured filter applied.</span>';
  return expression
    .split(/(?=[;,])/)
    .map((part) => part.replace(/^[;,]/, "").trim())
    .filter(Boolean)
    .map((part) => `<span class="chip">${escapeHtml(part)}</span>`)
    .join("");
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  for (const item of state.bootstrap.navigation || []) {
    const isActive = state.route.page === item.key || (item.key === "students" && state.route.page === "student-profile");
    const button = document.createElement("button");
    button.className = `nav-button${isActive ? " active" : ""}`;
    button.textContent = item.label;
    button.onclick = () => updateRoute({ page: item.key, studentId: "", settingsTab: "" });
    nav.appendChild(button);
  }
}

function setPageTitle(text) {
  document.getElementById("pageTitle").textContent = text;
}

function renderDashboard() {
  setPageTitle("Dashboard");
  const target = document.getElementById("dashboardPage");
  target.innerHTML = `
    <section class="dashboard-hero">
      <article class="hero-primary">
        <p class="eyebrow">Operational Status</p>
        <h3>Student Wellbeing Overview</h3>
        <p class="muted">A calmer operating surface for teams carrying sensitive casework. The profile, queue, and chronology views are all designed to reduce noise and sharpen decision speed.</p>
      </article>
      <article class="hero-aside">
        <p class="eyebrow">Structured Filtering</p>
        <h4>Bookmarkable working views</h4>
        <p>Filter language stays consistent across directory, concerns, meetings, chronology, and saved views.</p>
      </article>
    </section>
    <section class="grid-cards" id="headlineCards"></section>
    <section class="two-col">
      <div class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Operational Load</p>
            <h3 class="section-title">Active Team Radar</h3>
          </div>
        </div>
        <div id="teamLoadList" class="list"></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Filtering Pattern</p>
            <h3 class="section-title">Structured Filter Primer</h3>
          </div>
        </div>
        <div class="stack muted">
          <p><code>status==open</code></p>
          <p><code>radarTeam==safeguarding;priority==high</code></p>
          <p><code>yearGroup==Y8,(radarTeam==sendco,radarTeam==pastoral)</code></p>
          <p><code>assignedTo=in=(me,user123)</code></p>
        </div>
      </div>
    </section>
  `;

  callServer("/api/dashboard").then((data) => {
    const headline = data.headline || {};
    document.getElementById("headlineCards").innerHTML = [
      ["Students", headline.student_count || 0, "Directory coverage across the interim wellbeing estate."],
      ["Open Concerns", headline.open_concern_count || 0, "Items still in active review, triage, or escalation."],
      ["Active Radar", headline.active_radar_count || 0, "Current team involvement visible from the student profile."],
      ["Open Actions", headline.open_action_count || 0, "Interventions and support actions still underway."],
    ]
      .map(
        ([label, value, note], index) => `
          <article class="card ${index === 0 ? "headline-card" : "metric-card"}">
            <p class="eyebrow">${escapeHtml(label)}</p>
            <div class="card-number">${escapeHtml(value)}</div>
            <div class="metric-foot">
              <span class="metric-dot"></span>
              <span>${escapeHtml(note)}</span>
            </div>
          </article>`,
      )
      .join("");

    document.getElementById("teamLoadList").innerHTML = (data.teamLoad || [])
      .map(
        (team) => `
          <article class="list-row" style="cursor:default">
            <header>
              <div>
                <h4>${escapeHtml(team.name)}</h4>
                <p class="muted">${escapeHtml(team.team_key)}</p>
              </div>
              <span class="badge blue">${escapeHtml(team.active_students)} active</span>
            </header>
          </article>`,
      )
      .join("");
  });
}

function renderStudentsPage() {
  setPageTitle("Students");
  const target = document.getElementById("studentsPage");
  const savedOptions = (state.bootstrap.savedFilters || [])
    .filter((entry) => entry.area_key === "students")
    .map((entry) => `<option value="${escapeHtml(entry.filter_expression)}">${escapeHtml(entry.name)}</option>`)
    .join("");

  target.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Directory</p>
          <h3 class="section-title">Student Directory</h3>
        </div>
      </div>
      <div class="toolbar">
        <input id="studentSearch" class="search-input" value="${escapeHtml(state.route.q)}" placeholder="Search by student, name, or code">
        <input id="studentFilter" class="filter-input" value="${escapeHtml(state.route.filter)}" placeholder="Structured filter, for example yearGroup==Y8;hasOpenConcern==true">
        <select id="studentSavedFilter">
          <option value="">Saved filters</option>
          ${savedOptions}
        </select>
        <button class="button" id="applyStudentFilter">Apply</button>
      </div>
      <div class="chip-row" id="studentFilterChips">${renderFilterChips(state.route.filter)}</div>
    </section>
    <section class="list" id="studentList"></section>
  `;

  document.getElementById("applyStudentFilter").onclick = () => {
    updateRoute({
      page: "students",
      q: document.getElementById("studentSearch").value,
      filter: document.getElementById("studentFilter").value,
    });
  };
  document.getElementById("studentSavedFilter").onchange = (event) => {
    document.getElementById("studentFilter").value = event.target.value;
  };

  callServer("/api/students", {
    query: { q: state.route.q, filter: state.route.filter },
  }).then((data) => {
    const list = document.getElementById("studentList");
    const students = data.students || [];
    if (!students.length) {
      list.innerHTML = `<article class="panel"><p class="muted">No students matched this view.</p></article>`;
      return;
    }
    list.innerHTML = students
      .map(
        (student) => `
          <article class="list-row" data-student-id="${student.id}">
            <header>
              <div>
                <h4>${escapeHtml(student.preferred_name || student.first_name)} ${escapeHtml(student.last_name)}</h4>
                <p class="muted">${escapeHtml(student.student_code)} · ${escapeHtml(student.year_group || "No year group")} · ${escapeHtml(student.tutor_group || "No tutor group")}</p>
              </div>
              <div class="badge-row">
                ${student.safeguarding_flag ? '<span class="badge danger">Safeguarding Flag</span>' : ""}
                ${student.attendance_concern ? '<span class="badge warn">Attendance Concern</span>' : ""}
              </div>
            </header>
            <p>${escapeHtml(student.notes_summary || "No summary recorded.")}</p>
            <div class="chip-row">
              ${(student.radar || []).map((radar) => `<span class="chip">${escapeHtml(radar.teamName)} · ${escapeHtml(radar.status)}</span>`).join("")}
            </div>
          </article>`,
      )
      .join("");

    Array.from(list.querySelectorAll("[data-student-id]")).forEach((node) => {
      node.onclick = () => updateRoute({ page: "student-profile", studentId: node.dataset.studentId });
    });
  });
}

function renderStudentProfilePage() {
  setPageTitle("Student Profile");
  const target = document.getElementById("studentProfilePage");
  target.innerHTML = `<section class="panel"><p class="muted">Loading profile…</p></section>`;

  if (!state.route.studentId) {
    target.innerHTML = `<section class="panel"><p class="muted">Choose a student from the directory to open the operational profile.</p></section>`;
    return;
  }

  callServer(`/api/students/${encodeURIComponent(state.route.studentId)}`).then((data) => {
    const student = data.profile;
    const currentUser = state.bootstrap.currentUser || {};
    const permissionKeys = currentUser.permissionKeys || [];
    const canCreateConcern = permissionKeys.includes("*") || permissionKeys.includes("concerns.create");
    const canCreateMeeting = permissionKeys.includes("*") || permissionKeys.includes("meetings.create");

    target.innerHTML = `
      <section class="profile-grid">
        <div class="stack">
          <article class="profile-card">
            <p class="eyebrow">Student Profile</p>
            <h3>${escapeHtml(student.preferred_name || student.first_name)} ${escapeHtml(student.last_name)}</h3>
            <p class="muted">${escapeHtml(student.student_code)} · ${escapeHtml(student.year_group || "No year group")} · ${escapeHtml(student.tutor_group || "No tutor group")}</p>
            <div class="badge-row">
              ${(student.flags || []).map((flag) => `<span class="badge">${escapeHtml(flag.label)}</span>`).join("")}
              ${student.safeguarding_flag ? '<span class="badge danger">Safeguarding Flag</span>' : ""}
              ${student.attendance_concern ? '<span class="badge warn">Attendance Concern</span>' : ""}
            </div>
            <p>${escapeHtml(student.notes_summary || "No wellbeing summary recorded yet.")}</p>
          </article>

          <article class="panel">
            <div class="split-header">
              <div>
                <p class="eyebrow">Active Radar</p>
                <h3 class="section-title">Teams On Radar</h3>
              </div>
            </div>
            <div class="list">
              ${(data.radar || []).map((radar) => `
                <article class="list-row" style="cursor:default">
                  <header>
                    <div>
                      <h4>${escapeHtml(radar.team_name || "Unassigned team")}</h4>
                      <p class="muted">${escapeHtml(radar.category || "General")} · ${escapeHtml(radar.status)}</p>
                    </div>
                    <span class="badge">${escapeHtml(radar.severity || "medium")}</span>
                  </header>
                  <p>${escapeHtml(radar.summary || "No summary visible.")}</p>
                  <p class="muted small">${escapeHtml(radar.visibility)} visibility · added ${escapeHtml(formatDate(radar.occurred_at))}</p>
                </article>`).join("") || '<p class="muted">No team radar records visible.</p>'}
            </div>
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Chronology</p>
                <h3 class="section-title">Recent Timeline</h3>
              </div>
            </div>
            <div class="timeline">
              ${(data.chronology || []).map((item) => `
                <div class="timeline-item">
                  <h4>${escapeHtml(item.title)}</h4>
                  <p>${escapeHtml(item.summary || "Protected event")}</p>
                  <p class="muted small">${escapeHtml(item.team_name || "System")} · ${escapeHtml(item.visibility)} · ${escapeHtml(formatDate(item.occurred_at))}</p>
                </div>`).join("") || '<p class="muted">No chronology events visible.</p>'}
            </div>
          </article>
        </div>

        <div class="stack">
          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Quick Actions</p>
                <h3 class="section-title">Add Concern</h3>
              </div>
            </div>
            ${canCreateConcern ? `
            <div class="form-grid">
              <input id="concernTitle" class="span-2" placeholder="Concern title">
              <select id="concernCategory">
                <option value="attendance">Attendance</option>
                <option value="behaviour">Behaviour</option>
                <option value="safeguarding">Safeguarding</option>
                <option value="wellbeing">Wellbeing</option>
              </select>
              <select id="concernSeverity">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
              </select>
              <textarea id="concernSummary" class="span-2" rows="3" placeholder="Short operational summary"></textarea>
              <button class="button span-2" id="createConcernButton">Log concern</button>
            </div>` : '<p class="muted">You can view this profile, but concern creation is not assigned to your current role.</p>'}
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Quick Actions</p>
                <h3 class="section-title">Log Meeting</h3>
              </div>
            </div>
            ${canCreateMeeting ? `
            <div class="form-grid">
              <input id="meetingTitle" class="span-2" placeholder="Meeting title">
              <select id="meetingType">
                <option value="student_check_in">Student Check-In</option>
                <option value="parent_contact">Parent Contact</option>
                <option value="review_meeting">Review Meeting</option>
              </select>
              <input id="meetingOccurredAt" type="datetime-local">
              <textarea id="meetingSummary" class="span-2" rows="3" placeholder="Shareable summary"></textarea>
              <button class="button span-2" id="createMeetingButton">Log meeting</button>
            </div>` : '<p class="muted">Meeting logging is controlled by role and team policy.</p>'}
          </article>

          <article class="panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Visible Activity</p>
                <h3 class="section-title">Meetings And Concerns</h3>
              </div>
            </div>
            <div class="list">
              ${(data.concerns || []).slice(0, 4).map((item) => `
                <article class="list-row" style="cursor:default">
                  <header><h4>${escapeHtml(item.title)}</h4><span class="badge">${escapeHtml(item.status)}</span></header>
                  <p>${escapeHtml(item.summary || "Protected")}</p>
                </article>`).join("")}
              ${(data.meetings || []).slice(0, 4).map((item) => `
                <article class="list-row" style="cursor:default">
                  <header><h4>${escapeHtml(item.title)}</h4><span class="badge blue">${escapeHtml(item.interaction_type)}</span></header>
                  <p>${escapeHtml(item.summary || "Protected")}</p>
                </article>`).join("")}
              ${!(data.concerns || []).length && !(data.meetings || []).length ? '<p class="muted">No visible concerns or meetings in this profile view.</p>' : ""}
            </div>
          </article>
        </div>
      </section>
    `;

    const createConcernButton = document.getElementById("createConcernButton");
    if (createConcernButton) {
      createConcernButton.onclick = () => {
        callServer("/api/concerns", {
          method: "POST",
          payload: {
            studentId: state.route.studentId,
            title: document.getElementById("concernTitle").value,
            category: document.getElementById("concernCategory").value,
            severity: document.getElementById("concernSeverity").value,
            summary: document.getElementById("concernSummary").value,
          },
        }).then(() => {
          showMessage("Concern logged successfully.");
          renderStudentProfilePage();
        });
      };
    }

    const createMeetingButton = document.getElementById("createMeetingButton");
    if (createMeetingButton) {
      createMeetingButton.onclick = () => {
        callServer("/api/meetings", {
          method: "POST",
          payload: {
            studentId: state.route.studentId,
            title: document.getElementById("meetingTitle").value,
            interactionType: document.getElementById("meetingType").value,
            summary: document.getElementById("meetingSummary").value,
            occurredAt: document.getElementById("meetingOccurredAt").value || new Date().toISOString(),
          },
        }).then(() => {
          showMessage("Meeting logged successfully.");
          renderStudentProfilePage();
        });
      };
    }
  });
}

function renderConcernsPage() {
  setPageTitle("Concerns");
  const target = document.getElementById("concernsPage");
  target.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Concerns And Referrals</p>
          <h3 class="section-title">Filtered Concern Queue</h3>
        </div>
      </div>
      <div class="toolbar">
        <input id="concernSearch" class="search-input" value="${escapeHtml(state.route.q)}" placeholder="Search concerns or students">
        <input id="concernFilter" class="filter-input" value="${escapeHtml(state.route.filter)}" placeholder="status==open;severity==high">
        <button class="button" id="applyConcernFilter">Apply</button>
      </div>
      <div class="chip-row">${renderFilterChips(state.route.filter)}</div>
    </section>
    <section class="panel"><div id="concernTable"></div></section>
  `;

  document.getElementById("applyConcernFilter").onclick = () => {
    updateRoute({ page: "concerns", q: document.getElementById("concernSearch").value, filter: document.getElementById("concernFilter").value });
  };

  callServer("/api/concerns", {
    query: { q: state.route.q, filter: state.route.filter },
  }).then((data) => {
    const rows = data.concerns || [];
    document.getElementById("concernTable").innerHTML = `
      <table class="data-table">
        <thead><tr><th>Student</th><th>Concern</th><th>Status</th><th>Severity</th><th>Created</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}<br><span class="muted small">${escapeHtml(row.year_group || "")}</span></td>
              <td>${escapeHtml(row.title)}<br><span class="muted small">${escapeHtml(row.summary)}</span></td>
              <td>${escapeHtml(row.status)}</td>
              <td>${escapeHtml(row.severity)}</td>
              <td>${escapeHtml(formatDate(row.created_at))}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  });
}

function renderMeetingsPage() {
  setPageTitle("Meetings");
  const target = document.getElementById("meetingsPage");
  target.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Interactions Feed</p>
          <h3 class="section-title">Meeting And Interaction Feed</h3>
        </div>
      </div>
      <div class="toolbar">
        <input id="meetingSearchPage" class="search-input" value="${escapeHtml(state.route.q)}" placeholder="Search meetings or students">
        <input id="meetingFilterPage" class="filter-input" value="${escapeHtml(state.route.filter)}" placeholder="interactionType==student_check_in">
        <button class="button" id="applyMeetingFilter">Apply</button>
      </div>
      <div class="chip-row">${renderFilterChips(state.route.filter)}</div>
    </section>
    <section class="list" id="meetingFeed"></section>
  `;

  document.getElementById("applyMeetingFilter").onclick = () => {
    updateRoute({ page: "meetings", q: document.getElementById("meetingSearchPage").value, filter: document.getElementById("meetingFilterPage").value });
  };

  callServer("/api/meetings", {
    query: { q: state.route.q, filter: state.route.filter },
  }).then((data) => {
    const feed = document.getElementById("meetingFeed");
    const meetings = data.meetings || [];
    feed.innerHTML = meetings.map((item) => `
      <article class="list-row" style="cursor:default">
        <header>
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p class="muted">${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)} · ${escapeHtml(item.team_name || "No team")}</p>
          </div>
          <span class="badge blue">${escapeHtml(item.interaction_type)}</span>
        </header>
        <p>${escapeHtml(item.summary)}</p>
        <div class="meta-row">
          <span>${escapeHtml(formatDate(item.occurred_at))}</span>
          <span>${escapeHtml(item.visibility_level)}</span>
        </div>
      </article>`).join("");
  });
}

function renderSettingsPage() {
  setPageTitle("Settings");
  const target = document.getElementById("settingsPage");
  target.innerHTML = `<section class="panel"><p class="muted">Loading settings…</p></section>`;

  callServer("/api/settings/reference").then((data) => {
    const tab = state.route.settingsTab || "users";
    const tabs = [
      ["users", "Users"],
      ["roles", "Roles"],
      ["teams", "Teams"],
      ["visibility", "Visibility Matrix"],
      ["audit", "Audit Log"],
    ];

    const bodyByTab = {
      users: `
        <div class="two-col">
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Users</h3></div>
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
              <tbody>${(data.users || []).map((user) => `<tr><td>${escapeHtml(user.display_name)}</td><td>${escapeHtml(user.email)}</td><td>${user.is_active ? "Active" : "Inactive"}</td></tr>`).join("")}</tbody>
            </table>
          </article>
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Add Or Update User</h3></div>
            <div class="form-grid">
              <input id="userEmail" class="span-2" placeholder="user@school.org">
              <input id="userDisplayName" class="span-2" placeholder="Display name">
              <select id="userPrimaryTeam">${(data.teams || []).map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("")}</select>
              <select id="userActive"><option value="true">Active</option><option value="false">Inactive</option></select>
              <button class="button span-2" id="saveUserButton">Save user</button>
            </div>
          </article>
        </div>`,
      roles: `
        <div class="two-col">
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Roles</h3></div>
            <table class="data-table">
              <thead><tr><th>Role</th><th>Description</th><th>System</th></tr></thead>
              <tbody>${(data.roles || []).map((role) => `<tr><td>${escapeHtml(role.name)}</td><td>${escapeHtml(role.description || "")}</td><td>${role.is_system ? "Yes" : "No"}</td></tr>`).join("")}</tbody>
            </table>
          </article>
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Add Custom Role</h3></div>
            <div class="form-grid">
              <input id="roleKey" placeholder="role key">
              <input id="roleName" placeholder="Role name">
              <textarea id="roleDescription" class="span-2" rows="3" placeholder="Role description"></textarea>
              <select id="rolePermissions" class="span-2" multiple size="8">${(data.permissions || []).map((permission) => `<option value="${permission.permission_key}">${escapeHtml(permission.permission_key)}</option>`).join("")}</select>
              <button class="button span-2" id="saveRoleButton">Save role</button>
            </div>
          </article>
        </div>`,
      teams: `
        <div class="two-col">
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Teams</h3></div>
            <table class="data-table">
              <thead><tr><th>Team</th><th>Key</th><th>Active</th></tr></thead>
              <tbody>${(data.teams || []).map((team) => `<tr><td>${escapeHtml(team.name)}</td><td>${escapeHtml(team.team_key)}</td><td>${team.is_active ? "Yes" : "No"}</td></tr>`).join("")}</tbody>
            </table>
          </article>
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Add Or Update Team</h3></div>
            <div class="form-grid">
              <input id="teamKey" placeholder="team key">
              <input id="teamName" placeholder="Team name">
              <input id="teamAccentColor" value="#735c00" placeholder="#735c00">
              <select id="teamActive"><option value="true">Active</option><option value="false">Inactive</option></select>
              <textarea id="teamDescription" class="span-2" rows="3" placeholder="Description"></textarea>
              <button class="button span-2" id="saveTeamButton">Save team</button>
            </div>
          </article>
        </div>`,
      visibility: `
        <div class="two-col">
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Visibility Matrix</h3></div>
            <table class="data-table">
              <thead><tr><th>Source Team</th><th>Target Team</th><th>Content</th><th>Level</th></tr></thead>
              <tbody>${(data.visibilityRules || []).map((rule) => `<tr><td>${escapeHtml(rule.source_team_name)}</td><td>${escapeHtml(rule.target_team_name)}</td><td>${escapeHtml(rule.content_type)}</td><td>${escapeHtml(rule.visibility_level)}</td></tr>`).join("")}</tbody>
            </table>
          </article>
          <article class="panel">
            <div class="panel-header"><h3 class="section-title">Add Or Update Rule</h3></div>
            <div class="form-grid">
              <select id="visibilitySource">${(data.teams || []).map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("")}</select>
              <select id="visibilityTarget">${(data.teams || []).map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("")}</select>
              <select id="visibilityContent">
                <option value="radar">Radar</option>
                <option value="concerns">Concerns</option>
                <option value="meetings">Meetings</option>
                <option value="actions">Actions</option>
                <option value="chronology">Chronology</option>
              </select>
              <select id="visibilityLevel">
                <option value="none">None</option>
                <option value="indicator">Indicator</option>
                <option value="summary">Summary</option>
                <option value="full">Full</option>
              </select>
              <button class="button span-2" id="saveVisibilityButton">Save visibility rule</button>
            </div>
          </article>
        </div>`,
      audit: `
        <article class="panel">
          <div class="panel-header"><h3 class="section-title">Recent Audit Activity</h3></div>
          <div id="auditLogTable"><p class="muted">Loading audit activity…</p></div>
        </article>`,
    };

    target.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          ${tabs.map(([key, label]) => `<button class="button ${tab === key ? "" : "secondary"}" data-settings-tab="${key}">${label}</button>`).join("")}
        </div>
      </section>
      ${bodyByTab[tab]}
    `;

    Array.from(target.querySelectorAll("[data-settings-tab]")).forEach((button) => {
      button.onclick = () => updateRoute({ page: "settings", settingsTab: button.dataset.settingsTab });
    });

    const saveUserButton = document.getElementById("saveUserButton");
    if (saveUserButton) {
      saveUserButton.onclick = () => {
        callServer("/api/settings/users", {
          method: "POST",
          payload: {
            email: document.getElementById("userEmail").value,
            displayName: document.getElementById("userDisplayName").value,
            primaryTeamId: document.getElementById("userPrimaryTeam").value,
            isActive: document.getElementById("userActive").value === "true",
          },
        }).then(() => {
          showMessage("User saved successfully.");
          renderSettingsPage();
        });
      };
    }

    const saveRoleButton = document.getElementById("saveRoleButton");
    if (saveRoleButton) {
      saveRoleButton.onclick = () => {
        const options = Array.from(document.getElementById("rolePermissions").selectedOptions).map((option) => option.value);
        callServer("/api/settings/roles", {
          method: "POST",
          payload: {
            roleKey: document.getElementById("roleKey").value,
            name: document.getElementById("roleName").value,
            description: document.getElementById("roleDescription").value,
            permissionKeys: options,
          },
        }).then(() => {
          showMessage("Role saved successfully.");
          renderSettingsPage();
        });
      };
    }

    const saveTeamButton = document.getElementById("saveTeamButton");
    if (saveTeamButton) {
      saveTeamButton.onclick = () => {
        callServer("/api/settings/teams", {
          method: "POST",
          payload: {
            teamKey: document.getElementById("teamKey").value,
            name: document.getElementById("teamName").value,
            description: document.getElementById("teamDescription").value,
            accentColor: document.getElementById("teamAccentColor").value,
            isActive: document.getElementById("teamActive").value === "true",
          },
        }).then(() => {
          showMessage("Team saved successfully.");
          renderSettingsPage();
        });
      };
    }

    const saveVisibilityButton = document.getElementById("saveVisibilityButton");
    if (saveVisibilityButton) {
      saveVisibilityButton.onclick = () => {
        callServer("/api/settings/visibility-rules", {
          method: "POST",
          payload: {
            sourceTeamId: document.getElementById("visibilitySource").value,
            targetTeamId: document.getElementById("visibilityTarget").value,
            contentType: document.getElementById("visibilityContent").value,
            visibilityLevel: document.getElementById("visibilityLevel").value,
          },
        }).then(() => {
          showMessage("Visibility rule saved successfully.");
          renderSettingsPage();
        });
      };
    }

    if (tab === "audit") {
      callServer("/api/audit-logs").then((auditData) => {
        document.getElementById("auditLogTable").innerHTML = `
          <table class="data-table">
            <thead><tr><th>When</th><th>Actor</th><th>Area</th><th>Action</th><th>Student</th></tr></thead>
            <tbody>
              ${(auditData.auditLogs || []).map((entry) => `
                <tr>
                  <td>${escapeHtml(formatDate(entry.created_at))}</td>
                  <td>${escapeHtml(entry.actor_name || "System")}</td>
                  <td>${escapeHtml(entry.area_key)}</td>
                  <td>${escapeHtml(entry.action_key)}</td>
                  <td>${entry.student_code ? escapeHtml(`${entry.student_code} · ${entry.first_name} ${entry.last_name}`) : ""}</td>
                </tr>`).join("")}
            </tbody>
          </table>`;
      });
    }
  });
}

function renderRoute() {
  showMessage("");
  ["dashboardPage", "studentsPage", "studentProfilePage", "concernsPage", "meetingsPage", "settingsPage"].forEach((id) => {
    document.getElementById(id).classList.add("hidden");
  });
  renderNav();

  if (state.route.page === "dashboard") {
    document.getElementById("dashboardPage").classList.remove("hidden");
    renderDashboard();
    return;
  }
  if (state.route.page === "students") {
    document.getElementById("studentsPage").classList.remove("hidden");
    renderStudentsPage();
    return;
  }
  if (state.route.page === "student-profile") {
    document.getElementById("studentProfilePage").classList.remove("hidden");
    renderStudentProfilePage();
    return;
  }
  if (state.route.page === "concerns") {
    document.getElementById("concernsPage").classList.remove("hidden");
    renderConcernsPage();
    return;
  }
  if (state.route.page === "meetings") {
    document.getElementById("meetingsPage").classList.remove("hidden");
    renderMeetingsPage();
    return;
  }
  if (state.route.page === "settings") {
    document.getElementById("settingsPage").classList.remove("hidden");
    renderSettingsPage();
    return;
  }
  updateRoute({ page: "dashboard", studentId: "", settingsTab: "" });
}

function bootstrapApp() {
  parseRoute();
  callServer("/api/bootstrap")
    .then((data) => {
      state.bootstrap = data;
      document.getElementById("currentUserPill").textContent = `${data.currentUser.displayName} · ${data.currentUser.email}`;
      renderRoute();
    })
    .catch((error) => {
      showMessage(error.message || "Unable to bootstrap the app", "error");
    });
}

window.addEventListener("popstate", () => {
  parseRoute();
  renderRoute();
});

bootstrapApp();

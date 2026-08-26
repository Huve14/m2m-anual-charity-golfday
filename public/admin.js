(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = {
    registrations: [],
    filtered: [],
    admin: null,
    generatedAt: null,
    refreshTimer: null,
  };

  const els = {
    loginView: $("#login-view"),
    loginForm: $("#login-form"),
    loginMessage: $("#login-message"),
    password: $("#admin-password"),
    passwordToggle: $("#password-toggle"),
    dashboardView: $("#dashboard-view"),
    dashboardSubtitle: $("#dashboard-subtitle"),
    refreshButton: $("#refresh-button"),
    exportButton: $("#export-button"),
    logoutButton: $("#logout-button"),
    search: $("#search-input"),
    status: $("#status-filter"),
    sponsorship: $("#sponsorship-filter"),
    loading: $("#loading-state"),
    empty: $("#empty-state"),
    tableWrap: $("#table-wrap"),
    rows: $("#registration-rows"),
    mobileList: $("#mobile-list"),
    resultCount: $("#result-count"),
    lastUpdated: $("#last-updated"),
    statRegistrations: $("#stat-registrations"),
    statFourballs: $("#stat-fourballs"),
    statPlayers: $("#stat-players"),
    statValue: $("#stat-value"),
    dialog: $("#detail-dialog"),
    dialogClose: $("#dialog-close"),
    detailId: $("#detail-id"),
    detailTitle: $("#detail-title"),
    detailBody: $("#detail-body"),
    toast: $("#toast"),
  };

  const currency = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  });
  const dateTime = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  });

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value, fallback = "Not supplied") {
    const result = value == null ? "" : String(value).trim();
    return result || fallback;
  }

  function money(value) {
    return currency.format(number(value)).replace(/\s/g, " ");
  }

  function date(value) {
    try {
      return dateTime.format(new Date(value));
    } catch {
      return "Unknown date";
    }
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 4200);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Non-JSON error responses are handled by the generic message below.
    }
    if (!response.ok) {
      const error = new Error(payload.message || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showLogin() {
    state.admin = null;
    state.registrations = [];
    state.filtered = [];
    window.clearInterval(state.refreshTimer);
    els.dashboardView.hidden = true;
    els.loginView.hidden = false;
    els.loginMessage.textContent = "";
    window.setTimeout(() => els.loginForm.elements.email.focus(), 80);
  }

  function showDashboard(admin) {
    state.admin = admin;
    els.loginView.hidden = true;
    els.dashboardView.hidden = false;
    els.dashboardSubtitle.textContent = `Signed in as ${admin.email}. Registration values are enquiries, not confirmed revenue.`;
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadRegistrations({ quiet: true });
    }, 120_000);
  }

  function renderMetrics() {
    const totals = state.registrations.reduce(
      (sum, item) => {
        sum.fourballs += number(item.fourball_count);
        sum.players += number(item.player_slots);
        sum.value += number(item.total_amount);
        return sum;
      },
      { fourballs: 0, players: 0, value: 0 },
    );
    els.statRegistrations.textContent = String(state.registrations.length);
    els.statFourballs.textContent = String(totals.fourballs);
    els.statPlayers.textContent = String(totals.players);
    els.statValue.textContent = money(totals.value);
  }

  function buildStatusOptions() {
    const selected = els.status.value;
    const statuses = [...new Set(state.registrations.map((item) => text(item.status, "New")))].sort();
    els.status.replaceChildren(new Option("All statuses", ""));
    statuses.forEach((status) => els.status.append(new Option(status, status)));
    if (statuses.includes(selected)) els.status.value = selected;
  }

  function searchable(item) {
    const players = Array.isArray(item.players)
      ? item.players.map((player) => `${text(player.name, "")} ${text(player.handicap, "")}`)
      : [];
    return [
      item.registration_id,
      item.contact_name,
      item.first_name,
      item.surname,
      item.company,
      item.email,
      item.phone,
      item.username,
      item.player_names_text,
      ...players,
    ].join(" ").toLowerCase();
  }

  function applyFilters() {
    const query = els.search.value.trim().toLowerCase();
    const status = els.status.value;
    const sponsorship = els.sponsorship.value;
    state.filtered = state.registrations.filter((item) => {
      if (query && !searchable(item).includes(query)) return false;
      if (status && text(item.status, "New") !== status) return false;
      if (sponsorship === "none" && item.sponsorship_option) return false;
      if (sponsorship === "sponsored" && !item.sponsorship_option) return false;
      return true;
    });
    renderRegistrations();
  }

  function statusPill(value) {
    const label = text(value, "New");
    return node("span", `pill${label.toLowerCase() === "new" ? " new" : ""}`, label);
  }

  function detailButton(item) {
    const button = node("button", "id-link", text(item.registration_id));
    button.type = "button";
    button.addEventListener("click", () => openDetails(item));
    return button;
  }

  function renderDesktopRow(item) {
    const row = document.createElement("tr");
    const idCell = document.createElement("td");
    idCell.append(detailButton(item));

    const contactCell = node("td", "contact");
    contactCell.append(
      node("strong", "", text(item.contact_name)),
      node("span", "", text(item.email)),
    );
    const companyCell = node("td", "", text(item.company));
    const fourballsCell = node("td", "", `${number(item.fourball_count)} × fourball`);
    const sponsorshipCell = node("td", "", text(item.sponsorship_label, "No hole sponsorship"));
    const totalCell = node("td", "money", money(item.total_amount));
    const statusCell = document.createElement("td");
    statusCell.append(statusPill(item.status));
    const submittedCell = node("td", "", date(item.submitted_at));
    row.append(idCell, contactCell, companyCell, fourballsCell, sponsorshipCell, totalCell, statusCell, submittedCell);
    return row;
  }

  function renderMobileCard(item) {
    const card = node("article", "mobile-card");
    const top = node("div", "mobile-card-top");
    const identity = document.createElement("div");
    identity.append(detailButton(item), node("h3", "", text(item.contact_name)), node("p", "", text(item.company)));
    top.append(identity, statusPill(item.status));
    const meta = node("div", "mobile-meta");
    [
      ["Fourballs", String(number(item.fourball_count))],
      ["Enquiry total", money(item.total_amount)],
      ["Sponsorship", text(item.sponsorship_label, "None")],
      ["Submitted", date(item.submitted_at)],
    ].forEach(([label, value]) => {
      const box = document.createElement("div");
      box.append(node("span", "", label), node("strong", "", value));
      meta.append(box);
    });
    card.append(top, meta);
    return card;
  }

  function renderRegistrations() {
    els.rows.replaceChildren(...state.filtered.map(renderDesktopRow));
    els.mobileList.replaceChildren(...state.filtered.map(renderMobileCard));
    const hasData = state.filtered.length > 0;
    els.loading.hidden = true;
    els.empty.hidden = hasData;
    els.tableWrap.hidden = !hasData;
    els.mobileList.hidden = !hasData;
    els.resultCount.textContent = `${state.filtered.length} of ${state.registrations.length} ${state.registrations.length === 1 ? "entry" : "entries"}`;
    els.lastUpdated.textContent = state.generatedAt
      ? `Updated ${date(state.generatedAt)}`
      : "Not yet updated";
  }

  function detailItem(label, value, options = {}) {
    const item = node("div", `detail-item${options.wide ? " wide" : ""}`);
    item.append(node("span", "", label));
    if (options.content) item.append(options.content);
    else item.append(node(options.paragraph ? "p" : "strong", "", text(value)));
    return item;
  }

  function playersContent(item) {
    const wrap = node("div", "players");
    const players = Array.isArray(item.players) ? item.players : [];
    if (!players.length) {
      wrap.append(node("div", "player", "Player names to follow"));
      return wrap;
    }
    players.forEach((player, index) => {
      const name = text(player.name, `Player ${index + 1}`);
      const handicap = text(player.handicap, "HCP not supplied");
      wrap.append(node("div", "player", `${index + 1}. ${name} · ${handicap}`));
    });
    return wrap;
  }

  function consentContent(item) {
    const wrap = node("div", "consents");
    [
      ["Registration consent", Boolean(item.registration_consent)],
      ["Player data authority", Boolean(item.player_data_consent)],
      ["Marketing consent", Boolean(item.marketing_consent)],
    ].forEach(([label, enabled]) => {
      wrap.append(node("span", `consent${enabled ? "" : " off"}`, `${label}: ${enabled ? "Yes" : "No"}`));
    });
    return wrap;
  }

  function openDetails(item) {
    els.detailId.textContent = text(item.registration_id);
    els.detailTitle.textContent = text(item.contact_name, "Registration details");
    const grid = node("div", "detail-grid");
    grid.append(
      detailItem("Company", item.company),
      detailItem("Status", item.status),
      detailItem("Email", item.email),
      detailItem("Mobile", item.phone),
      detailItem("Submitted", date(item.submitted_at)),
      detailItem("Account username", item.username),
      detailItem("Fourballs", number(item.fourball_count)),
      detailItem("Player places", number(item.player_slots)),
      detailItem("Fourball amount", money(item.fourball_amount)),
      detailItem("Sponsorship", item.sponsorship_label || "No hole sponsorship"),
      detailItem("Sponsorship amount", money(item.sponsorship_amount)),
      detailItem("Total enquiry value", money(item.total_amount)),
      detailItem("Players", "", { wide: true, content: playersContent(item) }),
      detailItem("Dietary requirements", item.dietary_requirements || "None supplied", { wide: true, paragraph: true }),
      detailItem("Notes", item.notes || "No notes supplied", { wide: true, paragraph: true }),
      detailItem("Consent record", "", { wide: true, content: consentContent(item) }),
    );
    els.detailBody.replaceChildren(grid);
    els.dialog.showModal();
  }

  async function loadRegistrations({ quiet = false } = {}) {
    if (!quiet) {
      els.loading.hidden = false;
      els.empty.hidden = true;
      els.tableWrap.hidden = true;
      els.mobileList.hidden = true;
    }
    els.refreshButton.disabled = true;
    try {
      const payload = await api("/api/admin-registrations");
      state.registrations = Array.isArray(payload.registrations) ? payload.registrations : [];
      state.generatedAt = payload.generatedAt || new Date().toISOString();
      renderMetrics();
      buildStatusOptions();
      applyFilters();
      if (quiet) showToast("Registration data is up to date.");
    } catch (error) {
      if (error.status === 401) {
        showLogin();
        showToast("Your admin session expired. Please sign in again.");
        return;
      }
      els.loading.hidden = true;
      els.empty.hidden = false;
      els.empty.querySelector("strong").textContent = "Unable to load entries";
      els.empty.querySelector("span").textContent = error.message;
      showToast(error.message);
    } finally {
      els.refreshButton.disabled = false;
    }
  }

  function csvCell(value) {
    let safe = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(safe) || /^[\t\r]/.test(safe)) safe = `'${safe}`;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!state.filtered.length) {
      showToast("There are no visible entries to export.");
      return;
    }
    const headers = ["Registration ID","Submitted","Status","Company","Contact","Email","Phone","Fourballs","Player slots","Players","Dietary requirements","Notes","Sponsorship","Fourball amount","Sponsorship amount","Total enquiry value","Marketing consent"];
    const rows = state.filtered.map((item) => [
      item.registration_id,item.submitted_at,item.status,item.company,item.contact_name,item.email,item.phone,item.fourball_count,item.player_slots,item.player_names_text,item.dietary_requirements,item.notes,item.sponsorship_label,item.fourball_amount,item.sponsorship_amount,item.total_amount,item.marketing_consent ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `m2m-golf-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${state.filtered.length} ${state.filtered.length === 1 ? "entry" : "entries"} exported.`);
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = els.loginForm.querySelector('button[type="submit"]');
    const form = new FormData(els.loginForm);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const website = String(form.get("website") || "");
    if (!email || !password) {
      els.loginMessage.textContent = "Enter your authorised email address and password.";
      return;
    }
    button.disabled = true;
    button.querySelector("span").textContent = "Signing in...";
    els.loginMessage.textContent = "";
    try {
      const payload = await api("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, website }),
      });
      els.loginForm.reset();
      showDashboard({ email: payload.email });
      await loadRegistrations();
    } catch (error) {
      els.loginMessage.textContent = error.message;
      els.password.focus();
      els.password.select();
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = "Open dashboard";
    }
  });

  els.passwordToggle.addEventListener("click", () => {
    const visible = els.password.type === "text";
    els.password.type = visible ? "password" : "text";
    els.passwordToggle.textContent = visible ? "Show" : "Hide";
    els.password.focus();
  });
  els.search.addEventListener("input", applyFilters);
  els.status.addEventListener("change", applyFilters);
  els.sponsorship.addEventListener("change", applyFilters);
  els.refreshButton.addEventListener("click", () => loadRegistrations({ quiet: true }));
  els.exportButton.addEventListener("click", exportCsv);
  els.logoutButton.addEventListener("click", async () => {
    els.logoutButton.disabled = true;
    try {
      await api("/api/admin-logout", { method: "POST" });
    } catch {
      // The local session is cleared even if the server is momentarily unavailable.
    }
    showLogin();
    els.logoutButton.disabled = false;
    showToast("You have been signed out securely.");
  });
  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  async function initialise() {
    try {
      const payload = await api("/api/admin-session");
      showDashboard(payload.admin);
      await loadRegistrations();
    } catch {
      showLogin();
    }
  }

  initialise();
})();

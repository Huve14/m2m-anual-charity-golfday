(() => {
  "use strict";
  const state = {
    hosts: [],
    activeModule: "enquiries",
    selectedFile: null,
    preview: null,
    pendingAccess: null,
    loaded: new Set(),
  };
  const $ = (selector) => document.querySelector(selector);
  const els = {
    tabs: [...document.querySelectorAll(".module-tab")],
    panels: [...document.querySelectorAll(".module-panel")],
    hostStats: $("#host-stats"),
    hostSearch: $("#host-search"),
    refreshHosts: $("#refresh-hosts"),
    hostList: $("#host-list"),
    importDrop: $("#import-drop"),
    importFile: $("#import-file"),
    importFileLabel: $("#import-file-label"),
    previewImport: $("#preview-import"),
    importMessage: $("#import-message"),
    previewDialog: $("#import-preview-dialog"),
    previewClose: $("#import-preview-close"),
    previewSummary: $("#preview-summary"),
    previewRows: $("#preview-rows"),
    previewMessage: $("#preview-message"),
    commitImport: $("#commit-import"),
    cancelImport: $("#cancel-import"),
    refreshHistory: $("#refresh-history"),
    batchList: $("#batch-list"),
    holesList: $("#holes-list"),
    accessDialog: $("#access-dialog"),
    accessClose: $("#access-dialog-close"),
    accessSummary: $("#access-summary"),
    accessAllocations: $("#access-allocations"),
    accessMessage: $("#access-message"),
    cancelAccess: $("#cancel-access"),
    confirmAccess: $("#confirm-access"),
  };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function formatDate(value) {
    if (!value) return "Not yet";
    try {
      return new Intl.DateTimeFormat("en-ZA", {
        timeZone: "Africa/Johannesburg",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return "Unknown";
    }
  }

  function account(host) {
    return Array.isArray(host.host_accounts) ? host.host_accounts[0] : host.host_accounts;
  }

  function bookings(host) {
    return Array.isArray(host.host_bookings) ? host.host_bookings : [];
  }

  function allocations(host) {
    return bookings(host).flatMap((booking) => booking.booking_allocations || []);
  }

  function playerProgress(host) {
    const fourballs = allocations(host).filter((item) => item.allocation_type === "fourball");
    const total = fourballs.length * 4;
    const complete = fourballs
      .flatMap((item) => item.fourball_players || [])
      .filter((player) => player.first_name && player.surname && player.handicap).length;
    return { total, complete };
  }

  function statCard(label, value, note) {
    const card = node("article", "stat");
    card.append(node("span", "stat-label", label), node("strong", "stat-value", String(value)), node("span", "stat-note", note));
    return card;
  }

  function renderHostStats() {
    const invited = state.hosts.filter((host) => ["invited", "active"].includes(account(host)?.account_status)).length;
    const sponsorships = state.hosts.reduce((sum, host) => sum + allocations(host).filter((item) => item.allocation_type === "hole_sponsorship").length, 0);
    const playerSlots = state.hosts.reduce((sum, host) => sum + playerProgress(host).total, 0);
    els.hostStats.replaceChildren(
      statCard("Host companies", state.hosts.length, "Confirmed imports"),
      statCard("Portal access", invited, "Invited or active"),
      statCard("Sponsorships", sponsorships, "Confirmed allocations"),
      statCard("Player places", playerSlots, "Across all fourballs"),
    );
  }

  function pill(status) {
    const value = String(status || "pending_review").replaceAll("_", " ");
    return node("span", `pill ${status === "active" ? "" : "new"}`, value);
  }

  function hostCard(host) {
    const card = node("article", "host-card");
    const top = node("div", "host-card-head");
    const identity = document.createElement("div");
    identity.append(node("h3", "", host.company_name), node("p", "", `${host.contact_first_name} ${host.contact_surname} · ${host.contact_email} · ${host.mobile}`));
    top.append(identity, pill(account(host)?.account_status));
    const allAllocations = allocations(host);
    const fourballs = allAllocations.filter((item) => item.allocation_type === "fourball");
    const sponsors = allAllocations.filter((item) => item.allocation_type === "hole_sponsorship");
    const progress = playerProgress(host);
    const meta = node("div", "host-card-meta");
    for (const [label, value] of [
      ["Fourballs", fourballs.length],
      ["Sponsorship", sponsors.length ? sponsors.map((item) => item.hole_number ? `Hole ${item.hole_number}` : "Awaiting hole").join(", ") : "None"],
      ["Roster", progress.total ? `${progress.complete} of ${progress.total}` : "Not required"],
    ]) {
      const item = document.createElement("div");
      item.append(node("span", "", label), node("strong", "", String(value)));
      meta.append(item);
    }
    const actions = node("div", "host-card-actions");
    const edit = node("button", "mini-action", "Edit contact");
    edit.type = "button";
    edit.addEventListener("click", () => editHost(host));
    const accessButton = node("button", "mini-action", account(host)?.last_access_sent_at ? "Resend access" : "Send access");
    accessButton.type = "button";
    accessButton.disabled = ["suspended", "deactivated"].includes(account(host)?.account_status);
    accessButton.addEventListener("click", () => openAccess(host));
    const suspend = node("button", "mini-action", account(host)?.account_status === "suspended" ? "Restore" : "Suspend");
    suspend.type = "button";
    suspend.addEventListener("click", () => toggleSuspend(host));
    const remove = node("button", "mini-action delete-user-action", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deleteHost(host));
    actions.append(edit, accessButton, suspend, remove);
    card.append(top, meta, actions);
    return card;
  }

  function renderHosts() {
    renderHostStats();
    const search = els.hostSearch.value.trim().toLowerCase();
    const filtered = state.hosts.filter((host) => !search || `${host.company_name} ${host.contact_email}`.toLowerCase().includes(search));
    els.hostList.replaceChildren(
      ...(filtered.length
        ? filtered.map(hostCard)
        : [(() => { const empty = node("div", "empty"); empty.append(node("strong", "", "No host companies"), node("span", "", "Import synthetic staging companies or change the search.")); return empty; })()]),
    );
  }

  async function loadHosts(force = false) {
    if (state.loaded.has("hosts") && !force) return;
    els.hostList.innerHTML = '<div class="loading"><span class="spinner"></span><span>Loading host companies...</span></div>';
    try {
      const result = await api("/api/admin-hosts");
      state.hosts = result.hosts || [];
      state.loaded.add("hosts");
      renderHosts();
      renderHoles();
    } catch (error) {
      els.hostList.textContent = error.message;
    }
  }

  function showModule(name) {
    state.activeModule = name;
    for (const tab of els.tabs) tab.setAttribute("aria-selected", String(tab.dataset.module === name));
    for (const panel of els.panels) panel.hidden = panel.id !== `module-${name}`;
    if (["hosts", "allocations"].includes(name)) loadHosts();
    if (name === "history") loadHistory();
  }

  function updateSelectedFile(file) {
    state.selectedFile = file || null;
    els.importFileLabel.textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "No spreadsheet selected";
    els.previewImport.disabled = !file;
    els.importMessage.textContent = "";
  }

  async function uploadFile(file) {
    const prepared = await api("/api/admin/imports/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      }),
    });
    const form = new FormData();
    form.append("cacheControl", "0");
    form.append("", file);
    const uploadResponse = await fetch(prepared.upload.signedUrl, {
      method: "PUT",
      headers: {
        apikey: prepared.upload.publishableKey,
        Authorization: `Bearer ${prepared.upload.publishableKey}`,
        "x-upsert": "false",
      },
      body: form,
    });
    if (!uploadResponse.ok) throw new Error("The spreadsheet could not be uploaded securely.");
    return prepared.upload.path;
  }

  function renderPreview(preview) {
    const summary = preview.summary;
    els.previewSummary.replaceChildren(
      ...[
        ["Rows", summary.totalRows],
        ["Additions", summary.additions],
        ["Updates", summary.updates],
        ["Issues", summary.invalidRows],
      ].map(([label, value]) => {
        const item = node("div", "preview-stat");
        item.append(node("span", "", label), node("strong", "", String(value)));
        return item;
      }),
    );
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Row</th><th>Action</th><th>Company</th><th>Email</th><th>Fourballs</th><th>Sponsorship / hole</th><th>Review</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const row of preview.rows) {
      const tr = document.createElement("tr");
      const values = [
        row.rowNumber,
        row.action,
        row.companyName,
        row.contactEmail,
        row.fourballQuantity,
        `${row.sponsorshipType}${row.holeNumber ? ` · Hole ${row.holeNumber}` : ""}`,
      ];
      for (const value of values) tr.append(node("td", "", String(value)));
      const review = document.createElement("td");
      review.append(node("strong", "", row.isValid ? "Ready" : "Requires correction"));
      for (const message of [...row.errors, ...row.warnings]) review.append(node("span", "row-message", message));
      tr.append(review);
      body.append(tr);
    }
    table.append(body);
    els.previewRows.replaceChildren(table);
    els.commitImport.disabled = !preview.canCommit;
    els.previewMessage.textContent = preview.canCommit ? "All rows are ready for the staging commit." : "Correct every issue and preview a new file before approving.";
    els.previewDialog.showModal();
  }

  async function previewImport() {
    const file = state.selectedFile;
    if (!file) return;
    els.previewImport.disabled = true;
    els.previewImport.querySelector("span").textContent = "Uploading securely...";
    els.importMessage.textContent = "";
    try {
      const path = await uploadFile(file);
      els.previewImport.querySelector("span").textContent = "Parsing values...";
      const preview = await api("/api/admin/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, fileName: file.name }),
      });
      state.preview = preview;
      renderPreview(preview);
    } catch (error) {
      els.importMessage.textContent = error.message;
    } finally {
      els.previewImport.disabled = !state.selectedFile;
      els.previewImport.querySelector("span").textContent = "Securely preview import";
    }
  }

  async function commitImport() {
    if (!state.preview?.batch?.id || !state.preview.canCommit) return;
    els.commitImport.disabled = true;
    els.commitImport.querySelector("span").textContent = "Saving batch...";
    els.previewMessage.textContent = "";
    try {
      const result = await api(`/api/admin/imports/${encodeURIComponent(state.preview.batch.id)}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: state.preview.batch.id, confirmed: true }),
      });
      els.previewMessage.textContent = `${result.result.companies} host companies and ${result.result.allocations} allocations saved. No email was sent.`;
      state.preview = null;
      state.loaded.delete("hosts");
      state.loaded.delete("history");
      window.setTimeout(() => {
        els.previewDialog.close();
        showModule("hosts");
      }, 1100);
    } catch (error) {
      els.previewMessage.textContent = error.message;
    } finally {
      els.commitImport.disabled = false;
      els.commitImport.querySelector("span").textContent = "Approve import";
    }
  }

  async function loadHistory(force = false) {
    if (state.loaded.has("history") && !force) return;
    els.batchList.innerHTML = '<div class="loading"><span class="spinner"></span><span>Loading import history...</span></div>';
    try {
      const result = await api("/api/admin-import-history");
      state.loaded.add("history");
      els.batchList.replaceChildren(
        ...(result.batches.length
          ? result.batches.map((batch) => {
              const row = node("article", "batch-row");
              const identity = document.createElement("div");
              identity.append(node("strong", "", batch.file_name), node("span", "", `${batch.uploaded_by_admin_email} · ${formatDate(batch.created_at)}`));
              row.append(
                identity,
                node("span", "", `Status\n${batch.status}`),
                node("span", "", `Rows\n${batch.total_rows}`),
                node("span", "", `Adds / updates\n${batch.additions} / ${batch.updates}`),
                node("span", "", `Issues\n${batch.invalid_rows}`),
              );
              return row;
            })
          : [node("div", "empty", "No import batches yet.")]),
      );
    } catch (error) {
      els.batchList.textContent = error.message;
    }
  }

  function renderHoles() {
    const sponsorships = state.hosts.flatMap((host) =>
      allocations(host)
        .filter((allocation) => allocation.allocation_type === "hole_sponsorship")
        .map((allocation) => ({ host, allocation })),
    );
    els.holesList.replaceChildren(
      ...(sponsorships.length
        ? sponsorships.map(({ host, allocation }) => {
            const card = node("article", "hole-admin-card");
            card.append(node("h3", "", host.company_name), node("p", "", allocation.package_catalog?.display_name || "Hole sponsorship"));
            const control = node("div", "hole-control");
            const select = document.createElement("select");
            select.setAttribute("aria-label", `Hole for ${host.company_name}`);
            select.append(new Option("Not assigned", ""));
            for (let hole = 1; hole <= 18; hole += 1) select.append(new Option(`Hole ${hole}`, String(hole), false, Number(allocation.hole_number) === hole));
            const save = node("button", "mini-action", "Save");
            save.type = "button";
            save.addEventListener("click", async () => {
              save.disabled = true;
              try {
                await api(`/api/admin/allocations/${encodeURIComponent(allocation.id)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: allocation.id, holeNumber: select.value || null }),
                });
                allocation.hole_number = select.value ? Number(select.value) : null;
                save.textContent = "Saved";
              } catch (error) {
                window.alert(error.message);
              } finally {
                save.disabled = false;
                window.setTimeout(() => { save.textContent = "Save"; }, 1200);
              }
            });
            control.append(select, save);
            card.append(control);
            return card;
          })
        : [node("div", "empty", "No sponsorship allocations have been imported yet.")]),
    );
  }

  function openAccess(host) {
    const hostAccount = account(host);
    if (!hostAccount) return;
    state.pendingAccess = { host, account: hostAccount };
    els.accessSummary.textContent = `${host.company_name} · ${hostAccount.login_email}`;
    els.accessAllocations.textContent = allocations(host)
      .map((item) => item.allocation_type === "fourball" ? `Fourball ${item.allocation_number}` : `${item.package_catalog?.display_name || "Hole sponsorship"} · ${item.hole_number ? `Hole ${item.hole_number}` : "hole not assigned"}`)
      .join("\n");
    els.accessMessage.textContent = "";
    els.accessDialog.showModal();
  }

  async function sendAccess() {
    if (!state.pendingAccess) return;
    els.confirmAccess.disabled = true;
    els.confirmAccess.querySelector("span").textContent = "Sending...";
    try {
      const result = await api(`/api/admin/host-accounts/${encodeURIComponent(state.pendingAccess.account.id)}/send-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: state.pendingAccess.account.id, confirmed: true }),
      });
      els.accessMessage.textContent = `Secure access sent to ${result.recipient}.`;
      state.loaded.delete("hosts");
      window.setTimeout(() => els.accessDialog.close(), 1000);
    } catch (error) {
      els.accessMessage.textContent = error.message;
    } finally {
      els.confirmAccess.disabled = false;
      els.confirmAccess.querySelector("span").textContent = "Send secure access";
    }
  }

  async function toggleSuspend(host) {
    const suspended = account(host)?.account_status === "suspended";
    if (!window.confirm(`${suspended ? "Restore" : "Suspend"} portal access for ${host.company_name}?`)) return;
    try {
      await api("/api/admin-hosts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: host.id, action: suspended ? "restore" : "suspend" }),
      });
      await loadHosts(true);
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function deleteHost(host) {
    if (!window.confirm(`Permanently delete ${host.company_name}, its allocations, guest roster and portal identity? This cannot be undone.`)) return;
    try {
      await api(`/api/admin-hosts?id=${encodeURIComponent(host.id)}&confirmed=true`, { method: "DELETE" });
      await loadHosts(true);
    } catch (error) {
      window.alert(error.message);
    }
  }

  function editHost(host) {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.innerHTML = `<header class="detail-head"><div><small>Host company</small><h2>Edit contact</h2></div><button class="dialog-close" type="button" aria-label="Close">×</button></header><form class="confirm-body"><label class="field"><span>Company reference</span><input name="companyReference"></label><label class="field"><span>Company name</span><input name="companyName" required></label><label class="field"><span>Contact first name</span><input name="contactFirstName" required></label><label class="field"><span>Contact surname</span><input name="contactSurname" required></label><label class="field"><span>Login email</span><input name="contactEmail" type="email" required></label><label class="field"><span>Mobile</span><input name="mobile" required></label><label class="field"><span>Internal notes</span><input name="internalNotes"></label><div class="confirm-actions"><button class="mini-action cancel" type="button">Cancel</button><button class="mini-action delete-confirm" type="submit">Save changes</button></div><p class="form-message"></p></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    for (const [name, value] of Object.entries({
      companyReference: host.company_reference,
      companyName: host.company_name,
      contactFirstName: host.contact_first_name,
      contactSurname: host.contact_surname,
      contactEmail: host.contact_email,
      mobile: host.mobile,
      internalNotes: host.internal_notes,
    })) form.elements[name].value = value || "";
    const close = () => dialog.close();
    dialog.querySelector(".dialog-close").addEventListener("click", close);
    dialog.querySelector(".cancel").addEventListener("click", close);
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await api("/api/admin-hosts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: host.id, action: "edit", ...values }),
        });
        close();
        await loadHosts(true);
      } catch (error) {
        form.querySelector(".form-message").textContent = error.message;
        submit.disabled = false;
      }
    });
    dialog.showModal();
  }

  for (const tab of els.tabs) tab.addEventListener("click", () => showModule(tab.dataset.module));
  els.hostSearch.addEventListener("input", renderHosts);
  els.refreshHosts.addEventListener("click", () => loadHosts(true));
  els.refreshHistory.addEventListener("click", () => loadHistory(true));
  els.importFile.addEventListener("change", () => updateSelectedFile(els.importFile.files?.[0]));
  for (const type of ["dragenter", "dragover"]) els.importDrop.addEventListener(type, (event) => { event.preventDefault(); els.importDrop.classList.add("dragging"); });
  for (const type of ["dragleave", "drop"]) els.importDrop.addEventListener(type, (event) => { event.preventDefault(); els.importDrop.classList.remove("dragging"); });
  els.importDrop.addEventListener("drop", (event) => updateSelectedFile(event.dataTransfer?.files?.[0]));
  els.previewImport.addEventListener("click", previewImport);
  els.previewClose.addEventListener("click", () => els.previewDialog.close());
  els.cancelImport.addEventListener("click", () => els.previewDialog.close());
  els.commitImport.addEventListener("click", commitImport);
  els.accessClose.addEventListener("click", () => els.accessDialog.close());
  els.cancelAccess.addEventListener("click", () => els.accessDialog.close());
  els.confirmAccess.addEventListener("click", sendAccess);
})();

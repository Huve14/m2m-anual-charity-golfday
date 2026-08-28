(() => {
  "use strict";
  const dietaryOptions = ["None", "Vegetarian", "Vegan", "Halaal", "Kosher", "Gluten-free", "Other"];
  const state = { account: null, dirty: new Set() };
  const els = {
    main: document.querySelector("#portal-main"),
    loading: document.querySelector("#loading-screen"),
    companyName: document.querySelector("#company-name"),
    companySummary: document.querySelector("#company-summary"),
    eventCard: document.querySelector("#event-card"),
    allocationGrid: document.querySelector("#allocation-grid"),
    rosterSection: document.querySelector("#roster-section"),
    fourballStack: document.querySelector("#fourball-stack"),
    progressValue: document.querySelector("#progress-value"),
    progressLabel: document.querySelector("#progress-label"),
    progressBar: document.querySelector("#progress-bar"),
    logout: document.querySelector("#logout-button"),
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

  function formatDate(value) {
    if (!value) return "Date to be confirmed";
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00+02:00`));
  }

  function money(value) {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0).replace(/\s/g, " ");
  }

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function allocations() {
    return (state.account?.company?.bookings || []).flatMap((booking) => booking.allocations || []);
  }

  function firstEvent() {
    return state.account?.company?.bookings?.[0]?.event || null;
  }

  function renderEvent() {
    const event = firstEvent();
    els.eventCard.replaceChildren(
      node("small", "", "Event details"),
      node("strong", "", event?.name || "M2M Invitational"),
      node("span", "", `${formatDate(event?.event_date)} · ${event?.venue || "Glendower Golf Club"} · Shotgun start ${String(event?.shotgun_start || "10:00").slice(0, 5)}`),
    );
  }

  function renderAllocations() {
    const cards = allocations().map((allocation) => {
      const card = node("article", "allocation-card");
      const isSponsorship = allocation.allocation_type === "hole_sponsorship";
      card.append(
        node("span", "allocation-type", isSponsorship ? "Sponsorship" : `Fourball ${allocation.allocation_number}`),
        node("h3", "", allocation.package?.display_name || (isSponsorship ? "Hole sponsorship" : "Fourball")),
        node("p", "", isSponsorship ? `Confirmed package · ${money(allocation.price_zar)}` : `Four player places · ${money(allocation.price_zar)}`),
      );
      if (isSponsorship) {
        card.append(
          allocation.hole_number
            ? node("strong", "hole-number", `Hole ${allocation.hole_number}`)
            : node("strong", "hole-pending", "Will be revealed closer to the event."),
        );
      } else {
        const completed = (allocation.players || []).filter(playerComplete).length;
        card.append(node("strong", "hole-number", `${completed} / 4`));
      }
      return card;
    });
    els.allocationGrid.replaceChildren(...cards);
  }

  function playerComplete(player) {
    return Boolean(player?.first_name && player?.surname && player?.handicap);
  }

  function playerField(label, name, value, type = "text") {
    const field = node("label", "field");
    field.append(node("span", "", label));
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    input.name = name;
    if (type !== "textarea") input.type = type;
    input.value = value || "";
    input.maxLength = type === "textarea" ? 1000 : 254;
    field.append(input);
    return field;
  }

  function dietaryField(player) {
    const wrap = document.createDocumentFragment();
    const selectField = node("label", "field");
    selectField.append(node("span", "", "Dietary requirement"));
    const select = document.createElement("select");
    select.name = "dietaryRequirement";
    for (const optionName of dietaryOptions) {
      const option = document.createElement("option");
      option.value = optionName;
      option.textContent = optionName;
      option.selected = optionName === (player.dietary_requirement || "None");
      select.append(option);
    }
    selectField.append(select);
    const other = playerField("Specific dietary requirement", "dietaryOther", player.dietary_other);
    other.classList.add("other-field");
    other.hidden = select.value !== "Other";
    select.addEventListener("change", () => {
      other.hidden = select.value !== "Other";
      if (other.hidden) other.querySelector("input").value = "";
    });
    wrap.append(selectField, other);
    return wrap;
  }

  function playerCard(player, slotNumber) {
    const card = node("section", "player-card");
    card.dataset.slot = String(slotNumber);
    const title = node("div", "player-title");
    title.append(node("h4", "", `Player ${slotNumber}`), node("span", "", playerComplete(player) ? "Complete" : "Details required"));
    const names = node("div", "field-row");
    names.append(
      playerField("First name", "firstName", player.first_name),
      playerField("Surname", "surname", player.surname),
    );
    const contact = node("div", "field-row");
    contact.append(
      playerField("Email", "email", player.email, "email"),
      playerField("Mobile", "mobile", player.mobile, "tel"),
    );
    const play = node("div", "field-row");
    play.append(playerField("Handicap", "handicap", player.handicap), dietaryField(player));
    const notes = node("div", "field-row");
    notes.append(
      playerField("Accessibility notes", "accessibilityNotes", player.accessibility_notes, "textarea"),
      playerField("Additional notes", "adminNotes", player.admin_notes, "textarea"),
    );
    card.append(title, names, contact, play, notes);
    return card;
  }

  function readPlayers(form) {
    return [...form.querySelectorAll(".player-card")].map((card) => ({
      slotNumber: Number(card.dataset.slot),
      firstName: card.querySelector('[name="firstName"]').value,
      surname: card.querySelector('[name="surname"]').value,
      email: card.querySelector('[name="email"]').value,
      mobile: card.querySelector('[name="mobile"]').value,
      handicap: card.querySelector('[name="handicap"]').value,
      dietaryRequirement: card.querySelector('[name="dietaryRequirement"]').value,
      dietaryOther: card.querySelector('[name="dietaryOther"]').value,
      accessibilityNotes: card.querySelector('[name="accessibilityNotes"]').value,
      adminNotes: card.querySelector('[name="adminNotes"]').value,
    }));
  }

  function renderProgress() {
    const fourballs = allocations().filter((item) => item.allocation_type === "fourball");
    const players = fourballs.flatMap((item) => item.players || []);
    const completed = players.filter(playerComplete).length;
    const total = fourballs.length * 4;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    els.progressValue.textContent = `${percentage}%`;
    els.progressLabel.textContent = `${completed} of ${total} player profiles complete`;
    els.progressBar.style.width = `${percentage}%`;
  }

  function renderRosters() {
    const fourballs = allocations().filter((item) => item.allocation_type === "fourball");
    if (!fourballs.length) {
      els.rosterSection.hidden = true;
      return;
    }
    const forms = fourballs.map((allocation, index) => {
      const form = node("form", "fourball-card");
      form.dataset.allocationId = allocation.id;
      form.noValidate = true;
      const head = node("header", "fourball-head");
      head.append(node("h3", "", `Fourball ${index + 1}`), node("span", "save-state", "All changes saved"));
      const grid = node("div", "player-grid");
      const playersBySlot = new Map((allocation.players || []).map((player) => [Number(player.slot_number), player]));
      for (let slot = 1; slot <= 4; slot += 1) grid.append(playerCard(playersBySlot.get(slot) || {}, slot));
      const consent = node("label", "consent-row");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "popiaAcknowledged";
      checkbox.required = true;
      consent.append(
        checkbox,
        node("span", "", "I confirm that I am authorised to provide these guests’ details and consent to M2M using dietary and accessibility information solely to arrange and administer the event."),
      );
      const actions = node("div", "fourball-actions");
      const message = node("span", "save-message", "Player details remain editable.");
      const button = node("button", "primary-button", "");
      button.type = "submit";
      button.append(node("span", "", "Save this fourball"), node("span", "", "→"));
      actions.append(message, button);
      form.append(head, grid, consent, actions);
      const saveState = head.querySelector(".save-state");
      form.addEventListener("input", () => {
        state.dirty.add(allocation.id);
        saveState.textContent = "Unsaved changes";
        saveState.className = "save-state dirty";
      });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!checkbox.checked) {
          message.textContent = "Confirm the POPIA acknowledgement before saving.";
          checkbox.focus();
          return;
        }
        button.disabled = true;
        button.querySelector("span").textContent = "Saving securely...";
        message.textContent = "Saving your guest information...";
        try {
          const result = await api(`/api/portal/fourballs/${encodeURIComponent(allocation.id)}/players`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              allocationId: allocation.id,
              players: readPlayers(form),
              popiaAcknowledged: true,
            }),
          });
          state.dirty.delete(allocation.id);
          saveState.textContent = "Saved";
          saveState.className = "save-state saved";
          message.textContent = `Saved ${new Date(result.savedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}. You can edit again at any time.`;
          renderProgressFromForms();
        } catch (error) {
          saveState.textContent = "Unsaved changes";
          saveState.className = "save-state dirty";
          message.textContent = error.message;
        } finally {
          button.disabled = false;
          button.querySelector("span").textContent = "Save this fourball";
        }
      });
      return form;
    });
    els.fourballStack.replaceChildren(...forms);
    renderProgress();
  }

  function renderProgressFromForms() {
    const forms = [...els.fourballStack.querySelectorAll("form")];
    const players = forms.flatMap(readPlayers);
    const completed = players.filter((player) => player.firstName.trim() && player.surname.trim() && player.handicap.trim()).length;
    const total = players.length;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    els.progressValue.textContent = `${percentage}%`;
    els.progressLabel.textContent = `${completed} of ${total} player profiles complete`;
    els.progressBar.style.width = `${percentage}%`;
  }

  function render(account) {
    state.account = account;
    const company = account.company;
    els.companyName.replaceChildren(document.createTextNode(company.company_name), document.createElement("br"), (() => { const span = document.createElement("span"); span.textContent = "Host portal."; return span; })());
    els.companySummary.textContent = `${company.contact_first_name} ${company.contact_surname}, this is the confirmed event workspace for ${company.company_name}.`;
    renderEvent();
    renderAllocations();
    renderRosters();
    els.loading.hidden = true;
    els.main.hidden = false;
  }

  els.logout.addEventListener("click", async () => {
    els.logout.disabled = true;
    await api("/api/portal-logout", { method: "POST" }).catch(() => {});
    window.location.replace("/host-login");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  (async () => {
    try {
      const payload = await api("/api/portal/me");
      render(payload.account);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.replace("/host-login");
        return;
      }
      els.loading.innerHTML = "";
      const panel = node("div", "empty-panel");
      panel.append(node("h3", "", "Portal unavailable"), node("p", "", error.message));
      els.loading.append(panel);
    }
  })();
})();

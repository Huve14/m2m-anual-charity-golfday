import { randomUUID } from "node:crypto";

export const FOURBALL_PRICE = 15000;
export const MAX_FOURBALLS = 6;
export const SPONSORSHIP_PRICES = Object.freeze({
  "": 0,
  "with-alcohol": 17000,
  "without-alcohol": 12500,
});

export const SPONSORSHIP_LABELS = Object.freeze({
  "": "No hole sponsorship",
  "with-alcohol": "Hole sponsorship with alcohol",
  "without-alcohol": "Hole sponsorship without alcohol",
});
const DEFAULT_PACKAGE_LABEL = "Four-ball package";

export class RegistrationInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegistrationInputError";
    this.statusCode = 400;
  }
}

function asString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function text(value, field, { required = false, max = 200 } = {}) {
  const result = asString(value).trim();
  if (required && !result) {
    throw new RegistrationInputError(`${field} is required.`);
  }
  if (result.length > max) {
    throw new RegistrationInputError(`${field} is too long.`);
  }
  return result;
}

export function buildRegistration(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RegistrationInputError("A valid registration is required.");
  }

  const parsedFourballs = asString(
    body.fourballs ??
      body.fourBalls ??
      body.qty ??
      body.fourballCount ??
      body.quantity ??
      "",
  ).trim();

  const rawCellPhone =
    body.cellPhone ??
    body.phone ??
    body.mobile ??
    body.mobilePhone ??
    body.contactPhone ??
    "";
  const rawContactName =
    body.contactName ??
    body.contact ??
    body.contactPerson ??
    `${asString(body.firstName)} ${asString(body.surname)}`.trim() ??
    "";

  const company = text(body.company, "Company", { required: true, max: 120 });
  const firstName = text(
    body.firstName,
    "First name",
    { required: false, max: 120 },
  );
  const surname = text(
    body.surname,
    "Surname",
    { required: false, max: 120 },
  );
  const contactName = text(rawContactName, "Contact name", {
    required: true,
    max: 120,
  });
  const effectiveFirstName =
    firstName || text(contactName.split(" ")[0] || "", "First name", { max: 120 });
  const effectiveSurname = surname || contactName.replace(effectiveFirstName, "").trim();
  const email = text(body.email, "Email", { required: true, max: 200 });
  const cellPhone = text(rawCellPhone, "Cell phone", {
    required: true,
    max: 30,
  });
  const notes = text(body.notes, "Notes", { max: 1500 });
  const dietaryRaw = text(body.dietary, "Dietary requirements", { max: 120 });
  const dietaryOther = text(body.dietaryOther ?? body.dietaryOtherRequirement, "Other dietary requirement", { max: 120 });
  const dietary =
    dietaryRaw === "Other" && dietaryOther
      ? `Other (${dietaryOther})`
      : dietaryRaw || "";
  const packageChoice = text(body.packageChoice || body.package, "Package", {
    max: 120,
  }) || DEFAULT_PACKAGE_LABEL;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RegistrationInputError("Enter a valid email address.");
  }
  if (!/^[+()\d\s.-]{7,30}$/.test(cellPhone)) {
    throw new RegistrationInputError("Enter a valid cell phone number.");
  }

  const fourballs =
    parsedFourballs === "5+"
      ? 5
      : Number(parsedFourballs || Number(body.fourballs));
  if (
    !Number.isInteger(fourballs) ||
    fourballs < 1 ||
    fourballs > MAX_FOURBALLS
  ) {
    throw new RegistrationInputError(
      `Fourballs must be between 1 and ${MAX_FOURBALLS}.`,
    );
  }

  const sponsorship =
    typeof body.sponsorship === "string" && Object.hasOwn(SPONSORSHIP_PRICES, body.sponsorship)
      ? body.sponsorship
      : ["with-alcohol", "without-alcohol"].includes(packageChoice)
        ? packageChoice
        : "";
  if (!Object.hasOwn(SPONSORSHIP_PRICES, sponsorship)) {
    throw new RegistrationInputError("Select a valid sponsorship option.");
  }

  const incomingPlayers = Array.isArray(body.players) ? body.players : [];
  const playerSlots = fourballs * 4;
  if (incomingPlayers.length > playerSlots) {
    throw new RegistrationInputError("Too many player records were supplied.");
  }

  const players = incomingPlayers
    .slice(0, playerSlots)
    .map((player, index) => ({
      name: text(player.name, `Player ${index + 1} name`, { max: 120 }),
      handicap: text(player.handicap, `Player ${index + 1} handicap`, {
        max: 12,
      }),
    }));

  const playerDetails = players
    .map(
      (player, index) =>
        `${index + 1}. ${player.name || "Name to follow"}${
          player.handicap ? `, HCP ${player.handicap}` : ""
        }`,
    )
    .join("\n");
  const rowPlayerNames =
    playerDetails && playerDetails.length > 0 ? playerDetails : "";

  const fourballAmount = fourballs * FOURBALL_PRICE;
  const sponsorshipAmount = SPONSORSHIP_PRICES[sponsorship];
  const registrationId =
    options.registrationId ??
    `M2M-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const submittedAt = (options.now ?? new Date()).toISOString();
  return {
    registrationId,
    submittedAt,
    account: {
      firstName: effectiveFirstName,
      surname: effectiveSurname,
      email,
      cellPhone,
      company,
      contactName,
      packageChoice,
      dietary,
      dietaryOther: dietaryOther,
      registrationId,
      submittedAt,
      fourballs,
      playerSlots,
      fourballAmount,
      sponsorship,
      sponsorshipAmount,
      totalAmount: fourballAmount + sponsorshipAmount,
      notes,
      status: "New",
      statusSource: "website",
      players,
    },
    supabaseRecord: {
      registration_id: registrationId,
      submitted_at: submittedAt,
      first_name: effectiveFirstName,
      surname: effectiveSurname,
      contact_name: contactName,
      email,
      cell_phone: cellPhone,
      company,
      package_choice: packageChoice,
      fourball_count: fourballs,
      player_slots: playerSlots,
      player_names: rowPlayerNames,
      dietary_requirements: dietary,
      dietary_other: dietaryOther,
      notes,
      sponsorship_option: sponsorship,
      sponsorship_label: SPONSORSHIP_LABELS[sponsorship],
      sponsorship_amount: sponsorshipAmount,
      fourball_amount: fourballAmount,
      total_amount: fourballAmount + sponsorshipAmount,
      source: "website",
      status: "New",
    },
    row: [
      submittedAt,
      registrationId,
      company,
      contactName,
      email,
      cellPhone,
      fourballs,
      playerSlots,
      rowPlayerNames,
      notes,
      fourballAmount,
      SPONSORSHIP_LABELS[sponsorship],
      sponsorshipAmount,
      fourballAmount + sponsorshipAmount,
      true,
      "New",
      "Website",
    ],
  };
}

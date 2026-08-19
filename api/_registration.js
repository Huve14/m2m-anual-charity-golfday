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

function text(value, field, { required = false, max = 200 } = {}) {
  const result = typeof value === "string" ? value.trim() : "";
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

  const company = text(body.company, "Company", { required: true, max: 120 });
  const firstName = text(body.firstName, "First name", { required: false, max: 120 });
  const surname = text(body.surname, "Surname", { required: false, max: 120 });
  const contactName = text(body.contactName, "Contact name", {
    required: true,
    max: 120,
  });
  const email = text(body.email, "Email", { required: true, max: 200 });
  const cellPhone = text(body.cellPhone, "Cell phone", {
    required: true,
    max: 30,
  });
  const notes = text(body.notes, "Notes", { max: 1500 });
  const dietary = text(body.dietary, "Dietary requirements", { max: 120 });
  const packageChoice = text(body.packageChoice || body.package, "Package", {
    max: 120,
  }) || DEFAULT_PACKAGE_LABEL;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RegistrationInputError("Enter a valid email address.");
  }
  if (!/^[+()\d\s.-]{7,30}$/.test(cellPhone)) {
    throw new RegistrationInputError("Enter a valid cell phone number.");
  }

  const fourballs = Number(body.fourballs);
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

  const players = Array.from({ length: playerSlots }, (_, index) => {
    const player = incomingPlayers[index] ?? {};
    return {
      name: text(player.name, `Player ${index + 1} name`, { max: 120 }),
      handicap: text(player.handicap, `Player ${index + 1} handicap`, {
        max: 12,
      }),
    };
  });

  const fourballAmount = fourballs * FOURBALL_PRICE;
  const sponsorshipAmount = SPONSORSHIP_PRICES[sponsorship];
  const registrationId =
    options.registrationId ??
    `M2M-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const submittedAt = (options.now ?? new Date()).toISOString();
  const playerDetails = players
    .map(
      (player, index) =>
        `${index + 1}. ${player.name || "Name to follow"}${
          player.handicap ? `, HCP ${player.handicap}` : ""
        }`,
    )
    .join("\n");

  return {
    registrationId,
    submittedAt,
    account: {
      firstName,
      surname,
      email,
      cellPhone,
      company,
      contactName,
      packageChoice,
      dietary,
      registrationId,
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
      playerDetails,
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

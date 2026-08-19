import assert from "node:assert/strict";
import test from "node:test";

import { RegistrationInputError, buildRegistration } from "../api/_registration.js";

test("buildRegistration supports legacy index.html form fields", () => {
  const registration = buildRegistration({
    company: "Acme Events",
    contact: "Alex Morgan",
    phone: "+27 11 555 9999",
    email: "alex@example.com",
    notes: "",
    dietary: "Other",
    dietaryOther: "No nuts",
    sponsorship: "with-alcohol",
    qty: 2,
    players: [{ name: "Alex Morgan", handicap: "12" }],
  });

  assert.equal(registration.account.contactName, "Alex Morgan");
  assert.equal(registration.account.firstName, "Alex");
  assert.equal(registration.account.surname, "Morgan");
  assert.equal(registration.account.dietary, "Other (No nuts)");
  assert.equal(registration.row[6], 2);
  assert.equal(registration.account.players.length, 1);
  assert.equal(registration.supabaseRecord.sponsorship_option, "with-alcohol");
  assert.equal(
    registration.supabaseRecord.player_names,
    "1. Alex Morgan, HCP 12",
  );
});

test("buildRegistration rejects invalid contact name", () => {
  assert.throws(
    () =>
      buildRegistration({
        company: "Acme Events",
        email: "alex@example.com",
        phone: "+27 11 555 9999",
        fourballs: 1,
      }),
    RegistrationInputError,
  );
});

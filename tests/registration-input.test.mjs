import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVACY_NOTICE_VERSION,
  RegistrationInputError,
  buildRegistration,
} from "../api/_registration.js";

const requiredConsents = {
  privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  registrationConsent: true,
  playerDataConsent: true,
  marketingConsent: false,
};

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
    ...requiredConsents,
  });

  assert.equal(registration.account.contactName, "Alex Morgan");
  assert.equal(registration.account.firstName, "Alex");
  assert.equal(registration.account.surname, "Morgan");
  assert.equal(registration.account.dietary, "Other (No nuts)");
  assert.equal(registration.row[6], 2);
  assert.equal(registration.account.players.length, 1);
  assert.equal(registration.supabaseRecord.sponsorship_option, "with-alcohol");
  assert.equal(registration.supabaseRecord.registration_consent, true);
  assert.equal(registration.supabaseRecord.marketing_consent, false);
  assert.equal(registration.supabaseRecord.privacy_notice_version, PRIVACY_NOTICE_VERSION);
  assert.ok(
    registration.supabaseRecord.consent_tags.includes(
      "m2m_authorised_backend_access",
    ),
  );
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
        ...requiredConsents,
      }),
    RegistrationInputError,
  );
});

test("buildRegistration rejects a missing required privacy consent", () => {
  assert.throws(
    () =>
      buildRegistration({
        company: "Acme Events",
        contact: "Alex Morgan",
        phone: "+27 11 555 9999",
        email: "alex@example.com",
        fourballs: 1,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        registrationConsent: false,
        playerDataConsent: true,
      }),
    /Consent to process your registration details is required/,
  );
});

test("buildRegistration records optional marketing consent separately", () => {
  const registration = buildRegistration({
    company: "Acme Events",
    contact: "Alex Morgan",
    phone: "+27 11 555 9999",
    email: "alex@example.com",
    fourballs: 1,
    ...requiredConsents,
    marketingConsent: true,
  });

  assert.equal(registration.account.marketingConsent, true);
  assert.ok(registration.account.consentTags.includes("direct_marketing"));
  assert.equal(
    registration.account.consentTextSnapshot.version,
    PRIVACY_NOTICE_VERSION,
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PRIVACY_NOTICE_VERSION,
  RegistrationInputError,
  buildRegistration,
  excelSafeCell,
} from "../api/_registration.js";

test("builds the confirmed M2M Invitational experience for Vercel", async () => {
  const [html, hole, golfStage, privacy, support, indexLogic, holeLogic, admin, host, auth] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/hole-2.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/golf-3d.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/privacy.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/support.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index-logic.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/hole-2-logic.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/admin.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/host.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/auth.html", import.meta.url), "utf8"),
  ]);
  const adminBundlePath = admin.match(/src="\/(assets\/admin-[^"]+\.js)"/)?.[1];
  assert.ok(adminBundlePath, "the admin entry references its compiled React bundle");
  const adminLogic = await readFile(new URL(`../dist/${adminBundlePath}`, import.meta.url), "utf8");

  assert.match(html, /M2M Invitational \| Fourball Registration/);
  assert.match(html, /Register your fourball/);
  assert.doesNotMatch(html, /Buy (?:your|a) fourball/i);
  assert.match(html, /m2m-favicon-32\.png\?v=2/);
  assert.match(html, /apple-touch-icon\.png\?v=2/);
  assert.match(html, /site\.webmanifest/);
  assert.match(html, /m2m-golf-plate\.png/);
  assert.match(html, /mobile-3d/);
  assert.match(html, /navigator\.deviceMemory/);
  assert.match(html, /connection\.saveData/);
  assert.match(html, /golfstageerror/);
  assert.match(html, /A Hole A Day Keeps the Boredom Away/);
  assert.match(html, /Enter your/);
  assert.match(html, /Contact person/);
  assert.match(html, /How many fourballs/);
  assert.match(html, /default&quot;:15000/);
  assert.match(html, /Hole sponsorship without alcohol, R12 500/);
  assert.match(html, /Hole sponsorship with alcohol, R17 000/);
  assert.match(html, /<option value="with-alcohol" disabled="\{\{ yes \}\}">/);
  assert.match(html, /select option:disabled/);
  assert.match(html, /-webkit-text-fill-color:#7A8089!important/);
  assert.match(html, /text-decoration:line-through/);
  assert.match(html, /Hole sponsorship with alcohol is sold out\. Please select another option\./);
  assert.match(html, /Shotgun start/);
  assert.match(html, /10:00/);
  assert.match(html, /BYE Foundation/);
  assert.match(html, /Sel&rsquo;s 50th Birthday/);
  assert.match(html, /The best hole wins an award and prize/);
  assert.doesNotMatch(html, /if \(kind === 'with-alcohol'\) return 17000/);
  assert.match(html, /if \(kind === 'without-alcohol'\) return 12500/);
  assert.match(html, /const total = qty \* this\.price \+ sponsorshipPrice/);
  assert.match(html, /\/api\/register/);
  assert.match(html, /Complete the company, contact person, mobile and email fields/);
  assert.match(html, /dietaryOther: f\.dietaryOther/);
  assert.match(html, /Privacy &amp; POPIA Notice/);
  assert.match(
    html,
    /Availability is limited, and submitting this form is an enquiry, not a confirmed reservation\. Our team will contact you within one business day\./,
  );
  assert.match(html, /data-availability-notice="true"/);
  assert.match(indexLogic, /Sending enquiry/);
  assert.match(indexLogic, /Enquiry submitted/);
  assert.match(indexLogic, /submitted an M2M Invitational enquiry/);
  assert.match(indexLogic, /Hole sponsorship with alcohol is sold out\. Please select another option\./);
  assert.doesNotMatch(indexLogic, /if \(kind === 'with-alcohol'\) return 17000/);
  assert.match(html, /data-post-enquiry-cta="true"/);
  assert.match(html, /\[data-post-enquiry-cta\]:visited/);
  assert.match(html, /\[data-post-enquiry-cta\] \*/);
  assert.match(html, /name="registrationConsent"/);
  assert.match(html, /name="playerDataConsent"/);
  assert.match(html, /name="marketingConsent"/);
  assert.match(html, /privacyNoticeVersion: 'POPIA-2026-08-20'/);
  assert.match(html, /m2m_authorised_backend_access|authorised event administrators/);
  assert.doesNotMatch(html, /6500|6,500|Better-Ball|Entries close|Excl\. VAT|Section 18A|Paul McGinley/);
  assert.doesNotMatch(html, /entry\.\d+|docs\.google\.com\/forms|formResponse/);
  assert.match(html, /data-registration-grid/);
  assert.match(html, /data-form-progress/);
  assert.match(html, /Registration progress/);
  assert.match(html, /data-consent-option/);
  assert.match(html, /enterkeyhint="next"/);
  assert.match(html, /font-size:16px!important/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /@media \(max-width:560px\)/);
  assert.match(html, /family=Montserrat/);
  assert.match(html, /font-family:(?:'Aquire','Montserrat',sans-serif|var\(--heading-font\))/);
  assert.doesNotMatch(html, /Archivo|Instrument Serif|JetBrains Mono/);
  assert.match(hole, /Glendower · Hole 2 \| Flythrough/);
  assert.match(hole, /Fly the hole/);
  assert.match(hole, /family=Montserrat/);
  assert.doesNotMatch(hole, /Archivo|Instrument Serif|JetBrains Mono|Aquire/);
  assert.match(golfStage, /Montserrat, Arial, sans-serif/);
  assert.match(golfStage, /\/vendor\/three\.module\.js/);
  assert.doesNotMatch(golfStage, /unpkg\.com\/three/);
  assert.match(html, /index-logic\.js/);
  assert.match(hole, /hole-2-logic\.js/);
  assert.match(indexLogic, /__dcLogicFactories\["index"\]/);
  assert.match(indexLogic, /AbortController/);
  assert.match(indexLogic, /credentials: 'same-origin'/);
  assert.match(indexLogic, /progressLabel/);
  assert.match(indexLogic, /addEventListener\('offline'/);
  assert.match(holeLogic, /__dcLogicFactories\["hole-2"\]/);
  assert.doesNotMatch(support, /new Function|unpkg\.com|BABEL_URL|ensureBabel/);
  assert.match(golfStage, /if \(!this\._camPos \|\| !this\._camTgt \|\| !this\._cam\) return/);
  assert.match(golfStage, /get isLite\(\)/);
  assert.match(golfStage, /lite \? 1 : constrained \? 1\.3 : 2/);
  assert.match(golfStage, /const NR = lite \? 900 : 3000/);
  assert.match(golfStage, /const NT = lite \? 260 : 620/);
  assert.match(privacy, /Privacy &amp; POPIA Notice/);
  assert.match(privacy, /Version POPIA-2026-08-20/);
  assert.match(privacy, /Backend access and sharing/);
  assert.match(privacy, /Information Regulator South Africa/);
  assert.match(admin, /M2M Golf Operations \| Admin/);
  assert.match(admin, /admin-root/);
  assert.match(admin, /noindex,nofollow,noarchive/);
  assert.match(host, /M2M Golf Day \| Host Portal/);
  assert.match(host, /host-root/);
  assert.match(auth, /Secure sign-in \| M2M Golf Day/);
  assert.match(auth, /auth-root/);
  assert.match(adminLogic, /\/api\/v1\/admin\/events/);
  assert.match(adminLogic, /\/api\/v1\/admin\/dashboard/);
  assert.match(adminLogic, /\/api\/v1\/admin\/fourballs/);
  assert.match(adminLogic, /\/api\/v1\/admin\/sponsorships/);
  assert.match(adminLogic, /\/api\/v1\/admin\/enquiries/);
  assert.match(adminLogic, /Operational exports/);
  assert.match(adminLogic, /Administrators and hosts/);
  assert.match(adminLogic, /Website enquiries/);
  assert.match(adminLogic, /Inventory and hole allocation/);
  assert.doesNotMatch(adminLogic, /SUPABASE_(?:SECRET|SERVICE_ROLE)/);
  assert.doesNotMatch(adminLogic, /raw_registration|consent_text_snapshot|user_id/);
});

test("neutralises spreadsheet formulas in user-controlled values", () => {
  assert.equal(excelSafeCell("=HYPERLINK(\"https://example.com\")"), "'=HYPERLINK(\"https://example.com\")");
  assert.equal(excelSafeCell("  +SUM(1,2)"), "'  +SUM(1,2)");
  assert.equal(excelSafeCell("Normal company"), "Normal company");
  assert.equal(excelSafeCell(15000), 15000);
});

test("keeps secrets and provider diagnostics out of public registration responses", async () => {
  const [accountSource, registerSource, healthSource, vercelConfig] =
    await Promise.all([
      readFile(new URL("../api/_supabase-account.js", import.meta.url), "utf8"),
      readFile(new URL("../api/register.js", import.meta.url), "utf8"),
      readFile(new URL("../api/registration-health.js", import.meta.url), "utf8"),
      readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ]);

  assert.doesNotMatch(accountSource, /temporaryPassword|randomPassword|email_confirm|\/auth\/v1\/admin/);
  assert.match(accountSource, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.match(accountSource, /startsWith\("sb_secret_"\)/);
  assert.doesNotMatch(registerSource, /autoAccount|friendlyMessage|providerResponse/);
  assert.doesNotMatch(healthSource, /serviceRoleConfigured|registrationTable|composioApiConfigured/);
  assert.match(vercelConfig, /Content-Security-Policy/);
  assert.match(vercelConfig, /frame-ancestors 'none'/);
  assert.match(vercelConfig, /script-src 'self';/);
  assert.doesNotMatch(vercelConfig, /unsafe-eval|unpkg\.com/);
  assert.match(vercelConfig, /X-Content-Type-Options/);
  assert.match(vercelConfig, /Permissions-Policy/);
});

test("builds a validated Excel row using server-side event pricing", () => {
  const registration = buildRegistration(
    {
      company: "Example Company",
      contactName: "Alex Smith",
      email: "alex@example.com",
      cellPhone: "+27 82 000 0000",
      fourballs: 2,
      sponsorship: "without-alcohol",
      notes: "Vegetarian meal",
      players: [{ name: "Alex Smith", handicap: "12" }],
      totalAmount: 1,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      registrationConsent: true,
      playerDataConsent: true,
      marketingConsent: false,
    },
    {
      now: new Date("2026-08-19T08:00:00.000Z"),
      registrationId: "M2M-TEST123",
    },
  );

  assert.equal(registration.row.length, 17);
  assert.equal(registration.row[1], "M2M-TEST123");
  assert.equal(registration.row[6], 2);
  assert.equal(registration.row[10], 30000);
  assert.equal(registration.row[12], 12500);
  assert.equal(registration.row[13], 42500);
  assert.match(registration.row[8], /Alex Smith, HCP 12/);
});

test("rejects invalid registration data before storage", () => {
  assert.throws(
    () =>
      buildRegistration({
        company: "Example Company",
        contactName: "Alex Smith",
        email: "not-an-email",
        cellPhone: "0820000000",
        fourballs: 1,
        sponsorship: "",
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        registrationConsent: true,
        playerDataConsent: true,
        marketingConsent: false,
      }),
    RegistrationInputError,
  );
});

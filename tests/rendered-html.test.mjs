import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RegistrationInputError,
  buildRegistration,
} from "../api/_registration.js";

test("builds the confirmed M2M Invitational experience for Vercel", async () => {
  const [html, hole, golfStage] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/hole-2.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/golf-3d.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /M2M Invitational \| Fourball Registration/);
  assert.match(html, /m2m-golf-plate\.png/);
  assert.match(html, /Bring the/);
  assert.match(html, /boardroom/);
  assert.match(html, /Enter your/);
  assert.match(html, /Contact person/);
  assert.match(html, /How many fourballs/);
  assert.match(html, /default&quot;:15000/);
  assert.match(html, /Hole sponsorship with alcohol, R17,000/);
  assert.match(html, /Hole sponsorship without alcohol, R12,500/);
  assert.match(html, /Shotgun start/);
  assert.match(html, /10:00/);
  assert.match(html, /BYE Foundation/);
  assert.match(html, /Sel&rsquo;s 50th Birthday/);
  assert.match(html, /The best hole wins an award and prize/);
  assert.match(html, /if \(kind === 'with-alcohol'\) return 17000/);
  assert.match(html, /if \(kind === 'without-alcohol'\) return 12500/);
  assert.match(html, /const total = qty \* this\.price \+ sponsorshipPrice/);
  assert.match(html, /\/api\/register/);
  assert.match(html, /Complete the company, contact person, mobile and email fields/);
  assert.doesNotMatch(html, /6500|6,500|Better-Ball|Entries close|Excl\. VAT|Section 18A|Paul McGinley/);
  assert.doesNotMatch(html, /entry\.\d+|docs\.google\.com\/forms|formResponse/);
  assert.match(html, /data-registration-grid/);
  assert.match(html, /@media \(max-width:560px\)/);
  assert.match(html, /family=Montserrat/);
  assert.match(html, /font-family:(?:'Aquire','Montserrat',sans-serif|var\(--heading-font\))/);
  assert.doesNotMatch(html, /Archivo|Instrument Serif|JetBrains Mono/);
  assert.match(hole, /Glendower · Hole 2 \| Flythrough/);
  assert.match(hole, /Fly the hole/);
  assert.match(hole, /family=Montserrat/);
  assert.doesNotMatch(hole, /Archivo|Instrument Serif|JetBrains Mono|Aquire/);
  assert.match(golfStage, /Montserrat, Arial, sans-serif/);
  assert.match(golfStage, /if \(!this\._camPos \|\| !this\._camTgt \|\| !this\._cam\) return/);
  assert.match(golfStage, /constrained \? 1\.3 : 2/);
});

test("builds a validated Excel row using server-side event pricing", () => {
  const registration = buildRegistration(
    {
      company: "Example Company",
      contactName: "Alex Smith",
      email: "alex@example.com",
      cellPhone: "+27 82 000 0000",
      fourballs: 2,
      sponsorship: "with-alcohol",
      notes: "Vegetarian meal",
      players: [{ name: "Alex Smith", handicap: "12" }],
      totalAmount: 1,
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
  assert.equal(registration.row[12], 17000);
  assert.equal(registration.row[13], 47000);
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
      }),
    RegistrationInputError,
  );
});

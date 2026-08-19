import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /Sponsorship selection:/);
  assert.doesNotMatch(html, /6500|6,500|Better-Ball|Entries close|Excl\. VAT|Section 18A|Paul McGinley/);
  assert.match(html, /entry\.437593400/);
  assert.match(html, /entry\.399152369/);
  assert.match(html, /entry\.368685638/);
  assert.match(html, /entry\.912449741/);
  assert.match(html, /docs\.google\.com\/forms/);
  assert.match(html, /data-registration-grid/);
  assert.match(html, /@media \(max-width:560px\)/);
  assert.match(html, /family=Montserrat/);
  assert.match(html, /font-family:'Aquire','Montserrat',sans-serif/);
  assert.doesNotMatch(html, /Archivo|Instrument Serif|JetBrains Mono/);
  assert.match(hole, /Glendower · Hole 2 \| Flythrough/);
  assert.match(hole, /Fly the hole/);
  assert.match(hole, /family=Montserrat/);
  assert.doesNotMatch(hole, /Archivo|Instrument Serif|JetBrains Mono|Aquire/);
  assert.match(golfStage, /Montserrat, Arial, sans-serif/);
  assert.match(golfStage, /if \(!this\._camPos \|\| !this\._camTgt \|\| !this\._cam\) return/);
  assert.match(golfStage, /constrained \? 1\.3 : 2/);
});

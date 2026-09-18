// Run against /admin.html in a local Playwright page. Uses sample records, never production data.
export default async function verifyPagePdf(page) {
  const tabs = ['overview','setup','companies','sponsorships','suppliers','fourballs','tee','hosts','players','gala'];
  const results = [];
  for (const tab of tabs) {
    await page.evaluate(async (tab) => {
      document.getElementById('admin-root')?.remove();
      document.getElementById('event-page-content')?.remove();
      const content = document.createElement('main');
      content.id = 'event-page-content';
      content.innerHTML = `<h2>${tab} records</h2><div class="panel"><table><thead><tr><th>Company</th><th>Details</th></tr></thead><tbody><tr><td>Sample Sponsor</td><td>Confirmed ${tab} record</td></tr></tbody></table><label>Contact <input value="Saved contact"></label><textarea>Saved notes</textarea><select><option>Confirmed</option></select><button>Remove record</button><p hidden>Hidden secret</p></div>`;
      if (tab === 'sponsorships') content.innerHTML += '<section class="hole-allocation-workspace"><div class="hole-course"><div class="hole-number-grid">' + Array.from({length:18}, (_,i)=>`<button aria-pressed="${i===8}"><strong>${String(i+1).padStart(2,'0')}</strong><span>${i===0?'2/2':'1/1'} placed</span><span class="hole-company-names">${i===0?'Club shine · M2M':`Sponsor ${i+1}`}</span></button>`).join('')+'</div></div></section>';
      document.body.appendChild(content);
      const original = content.outerHTML;
      const open = window.open.bind(window);
      window.open = (...args) => { const win = open(...args); win.print = () => { win.__printCalls = (win.__printCalls || 0) + 1; win.dispatchEvent(new Event('afterprint')); }; return win; };
      try { await (await import('/src/admin/exportPagePdf.ts')).exportPagePdf(content, `Golf day — ${tab}`); }
      finally { window.open = open; }
      if (content.outerHTML !== original) throw new Error('Original content changed');
    }, tab);
    const preview = page.context().pages().at(-1);
    if (preview === page) throw new Error('Preview did not open');
    await preview.waitForFunction(() => window.__printCalls === 1);
    await preview.emulateMedia({media:'print'});
    const result = await preview.evaluate(() => {
      const text = document.body.innerText;
      const cards = document.querySelectorAll('.hole-number-grid > button');
      if (!text.includes('Sample Sponsor') || !text.includes('Saved contact') || !text.includes('Saved notes') || text.includes('Remove record') || text.includes('Hidden secret')) throw new Error('Snapshot content regression');
      if (getComputedStyle(document.querySelector('.page-export-controls')).display !== 'none') throw new Error('Print controls leaked');
      return {cards:cards.length, title:document.title};
    });
    await preview.pdf({path:`/tmp/page-export-${tab}.pdf`,preferCSSPageSize:true,printBackground:true});
    await preview.emulateMedia({media:'screen'});
    await preview.getByRole('button',{name:'Print / Save as PDF'}).click();
    if (await preview.evaluate(() => window.__printCalls) !== 2) throw new Error('Print retry failed');
    results.push({tab,...result});
    await preview.close();
  }
  return results;
}

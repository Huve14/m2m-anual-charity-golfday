window.__dcLogicFactories = window.__dcLogicFactories || {};
window.__dcLogicFactories["index"] = (DCLogic) => {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  
  class Component extends DCLogic {
    state = {
      shot: 0, done: false, sending: false, error: false,
      f: { company: '', contact: '', phone: '', email: '', notes: '', dietary: '', dietaryOther: '', sponsorship: '', qty: 1, players: {}, registrationConsent: false, playerDataConsent: false, marketingConsent: false }
    };
  
    componentDidMount() {
      this._stage = null;
      // the web component mounts asynchronously; grab it when it lands
      const find = () => {
        const el = document.querySelector('golf-stage');
        if (el && el.setShot) {
          this._stage = el;
          // the mount lowercases and collapses hyphenated attrs, so start-shot never
          // arrives, so drive the opening camera from our own state instead
          if (el.shot !== this.state.shot) el.setShot(this.state.shot);
          // keep the chip in step with the stage while it cycles on its own
          el.addEventListener('shotchange', e => this.setState({ shot: e.detail.shot }));
          el.startCycle();
          return;
        }
        this._t = setTimeout(find, 220);
      };
      find();
      // the backdrop is fixed, so it never stops "intersecting". Gate it on the two
      // sections that actually show it, or we burn GPU behind opaque content
      const windows = ['#top', '#register'].map(s => document.querySelector(s)).filter(Boolean);
      if (windows.length) {
        const seen = new Set();
        this._io = new IntersectionObserver(es => {
          for (const e of es) {
            if (e.isIntersecting) seen.add(e.target);
            else seen.delete(e.target);
          }
          const el = this._stage || document.querySelector('golf-stage');
          if (el) el._visible = seen.size > 0;
        }, { threshold: 0 });
        windows.forEach(w => this._io.observe(w));
      }
      // React does not reliably set the muted ATTRIBUTE, and without it autoplay is refused
      const v = document.querySelector('#course video');
      if (v) {
        v.muted = true;
        v.defaultMuted = true;
        v.setAttribute('muted', '');
        const go = () => v.play().catch(() => {});
        go();
        v.addEventListener('loadeddata', go, { once: true });
      }
    }
    componentWillUnmount() { clearTimeout(this._t); if (this._io) this._io.disconnect(); }
  
    get price() { return Math.max(0, Number(this.props.pricePerFourBall ?? 15000)); }
    get maxQty() { return Math.max(1, Number(this.props.maxFourBalls ?? 6)); }
    get cur() { return this.props.currency ?? 'R'; }
  
    money(n) { return this.cur + n.toLocaleString('en-ZA'); }
  
    sponsorPrice(kind) {
      if (kind === 'with-alcohol') return 17000;
      if (kind === 'without-alcohol') return 12500;
      return 0;
    }
  
    sponsorLabel(kind) {
      if (kind === 'with-alcohol') return 'Hole sponsorship with alcohol';
      if (kind === 'without-alcohol') return 'Hole sponsorship without alcohol';
      return '';
    }
  
    setShot(i) {
      this.setState({ shot: i });
      const el = this._stage || document.querySelector('golf-stage');
      if (!el || !el.setShot) return;
      this._stage = el;
      if (el.lockCamera) el.lockCamera();   // an explicit pick stops the auto-cycle
      el.setShot(i);
    }
  
    field(k) {
      return e => {
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        this.setState(s => ({ f: Object.assign({}, s.f, { [k]: v }) }));
      };
    }
  
    player(idx, key) {
      return e => {
        const v = e.target.value;
        this.setState(s => {
          const p = Object.assign({}, s.f.players);
          p[idx] = Object.assign({ name: '', hcp: '' }, p[idx], { [key]: v });
          return { f: Object.assign({}, s.f, { players: p }) };
        });
      };
    }
  
    bumpQty(d) {
      this.setState(s => ({
        f: Object.assign({}, s.f, { qty: Math.min(this.maxQty, Math.max(1, s.f.qty + d)) })
      }));
    }
  
    submit = async e => {
      e.preventDefault();
      if (this.state.sending) return;
      const f = this.state.f;
      if (!f.company.trim() || !f.contact.trim() || !f.phone.trim() || !f.email.trim()) {
        this.setState({ error: 'Complete the company, contact person, mobile and email fields.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
        this.setState({ error: 'Enter a valid email address.' });
        return;
      }
      if (!/^[+()\d\s.-]{7,30}$/.test(f.phone.trim())) {
        this.setState({ error: 'Enter a valid mobile number.' });
        return;
      }
      if (f.dietary === 'Other' && !f.dietaryOther.trim()) {
        this.setState({ error: 'Please specify your dietary requirement.' });
        return;
      }
      if (!f.registrationConsent) {
        this.setState({ error: 'Please read and accept the Privacy & POPIA Notice to register.' });
        return;
      }
      if (!f.playerDataConsent) {
        this.setState({ error: "Please confirm that you may provide the listed players' details." });
        return;
      }
      const players = [];
      for (let i = 0; i < f.qty * 4; i++) {
        const p = f.players[i] || {};
        players.push({ name: p.name || '', handicap: p.hcp || '' });
      }
  
      this.setState({ sending: true, error: '' });
      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: f.company,
            contactName: f.contact,
            cellPhone: f.phone,
            email: f.email,
            notes: f.notes,
            dietary: f.dietary,
            dietaryOther: f.dietaryOther,
            sponsorship: f.sponsorship,
            fourballs: f.qty,
            players,
            privacyNoticeVersion: 'POPIA-2026-08-20',
            registrationConsent: f.registrationConsent,
            playerDataConsent: f.playerDataConsent,
            marketingConsent: f.marketingConsent
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          throw new Error(result.message || 'We could not save your entry. Please try again.');
        }
      } catch (error) {
        this.setState({
          sending: false,
          error: error && error.message
            ? error.message
            : 'We could not save your entry. Please try again.'
        });
        return;
      }
      this.setState({ done: true, sending: false, shot: 1 });
      const st = this._stage || document.querySelector('golf-stage');
      if (st && st.setShot) { if (st.lockCamera) st.lockCamera(); st.setShot(1); }  // finish on the flyover
      setTimeout(() => {
        const a = document.querySelector('#register aside');
        if (a) window.scrollTo({ top: a.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
      }, 60);
    };
  
    renderVals() {
      const f = this.state.f;
      const qty = f.qty;
      const sponsorshipPrice = this.sponsorPrice(f.sponsorship);
      const total = qty * this.price + sponsorshipPrice;
  
      const raw = this.props.eventDate || '2026-09-22';
      const d = new Date(raw + 'T00:00:00');
      const ok = !isNaN(d.getTime());
      const dateShort = ok ? `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}` : 'Tue 22 Sep';
      const dateLong = ok ? `${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Tuesday 22 September 2026';
  
      const ORD = ['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth'];
      const PH = ['Player 1, team captain','Player 2, full name','Player 3, full name','Player 4, full name'];
      const groups = [];
      for (let g = 0; g < qty; g++) {
        const players = [];
        for (let i = 0; i < 4; i++) {
          const idx = g * 4 + i;
          const rec = f.players[idx] || {};
          players.push({
            num: String(idx + 1).padStart(2, '0'),
            name: rec.name || '',
            hcp: rec.hcp || '',
            ph: PH[i],
            onName: this.player(idx, 'name'),
            onHcp: this.player(idx, 'hcp')
          });
        }
        groups.push({ title: qty === 1 ? 'Fourball' : `${ORD[g]} fourball`, players });
      }
  
      const named = Object.values(f.players).filter(p => p && p.name && p.name.trim()).length;
  
      return {
        f, groups, done: this.state.done, error: this.state.error,
        dateShort, dateLong,
        priceLabel: this.money(this.price),
        totalLabel: this.money(total),
        hasSponsorship: sponsorshipPrice > 0,
        sponsorshipLabel: f.sponsorship ? `${this.sponsorLabel(f.sponsorship)}, ${this.money(sponsorshipPrice)}` : '',
        playerCount: `${named} of ${qty * 4} named`,
        qtyWord: qty === 1 ? 'fourball' : 'fourballs',
        qtyHint: qty >= this.maxQty
          ? `This form accepts up to ${this.maxQty} fourballs per registration.`
          : `That is ${qty * 4} players. Add another fourball if your company is registering another team.`,
        summaryTitle: `${qty} × Fourball`,
        summarySub: `${qty * 4} players at the M2M Invitational on ${dateLong}, shotgun start at 10:00.`,
        submitLabel: this.state.sending ? 'Sending entry' : this.state.done ? 'Entry submitted' : `Enter ${qty === 1 ? 'this fourball' : `these ${qty} fourballs`}`,
        doneMsg: `Thank you, ${f.company || 'your company'} has submitted an M2M Invitational registration for ${qty * 4} players. The event team will follow up at ${f.email || 'the email provided'}.`,
        yes: true,
        // a blocked club asset should reveal the labelled plate behind it, not a broken icon
        imgFail: e => { e.target.style.opacity = '0'; },
        shotBar: `${this.state.shot * 100}%`,
        shot0: () => this.setShot(0),
        shot1: () => this.setShot(1),
        inc: () => this.bumpQty(1),
        dec: () => this.bumpQty(-1),
        set: {
          company: this.field('company'), contact: this.field('contact'),
          phone: this.field('phone'), email: this.field('email'),
          notes: this.field('notes'),
          dietary: e => {
            const v = e.target.value;
            this.setState(s => ({
              f: Object.assign({}, s.f, {
                dietary: v,
                ...(v !== 'Other' ? { dietaryOther: '' } : {}),
              }),
            }));
          },
          dietaryOther: this.field('dietaryOther'),
          sponsorship: this.field('sponsorship'),
          registrationConsent: this.field('registrationConsent'),
          playerDataConsent: this.field('playerDataConsent'),
          marketingConsent: this.field('marketingConsent')
        },
        showDietaryOther: f.dietary === 'Other',
        onSubmit: this.submit
      };
    }
  }
  return Component;
};

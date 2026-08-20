window.__dcLogicFactories = window.__dcLogicFactories || {};
window.__dcLogicFactories["index"] = (DCLogic) => {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  
  class Component extends DCLogic {
    state = {
      shot: 0, done: false, sending: false, error: false, online: navigator.onLine,
      f: { company: '', contact: '', phone: '', email: '', notes: '', dietary: '', dietaryOther: '', sponsorship: '', qty: 1, players: {}, registrationConsent: false, playerDataConsent: false, marketingConsent: false }
    };
  
    componentDidMount() {
      this._stage = null;
      this._setNetworkState = () => this.setState({ online: navigator.onLine });
      window.addEventListener('online', this._setNetworkState);
      window.addEventListener('offline', this._setNetworkState);
      this._smoothAnchor = e => {
        const link = e.target.closest && e.target.closest('a[href^="#"]');
        if (!link) return;
        const id = link.getAttribute('href');
        const target = id && id.length > 1 ? document.querySelector(id) : document.querySelector('#top');
        if (!target) return;
        e.preventDefault();
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        history.replaceState(null, '', id || '#top');
      };
      document.addEventListener('click', this._smoothAnchor);
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
    componentWillUnmount() {
      clearTimeout(this._t);
      if (this._io) this._io.disconnect();
      window.removeEventListener('online', this._setNetworkState);
      window.removeEventListener('offline', this._setNetworkState);
      document.removeEventListener('click', this._smoothAnchor);
    }
  
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

    showError(message, selector) {
      this.setState({ error: message, sending: false });
      setTimeout(() => {
        const target = (selector && document.querySelector(selector)) || document.querySelector('[data-form-error]');
        if (!target) return;
        if (target.focus) target.focus({ preventScroll: true });
        target.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center'
        });
      }, 40);
    }
  
    submit = async e => {
      e.preventDefault();
      if (this.state.sending) return;
      const f = this.state.f;
      if (!f.company.trim() || !f.contact.trim() || !f.phone.trim() || !f.email.trim()) {
        const firstMissing = !f.company.trim() ? '[name="company"]'
          : !f.contact.trim() ? '[name="contact"]'
          : !f.phone.trim() ? '[name="phone"]' : '[name="email"]';
        this.showError('Complete the company, contact person, mobile and email fields.', firstMissing);
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
        this.showError('Enter a valid email address.', '[name="email"]');
        return;
      }
      if (!/^[+()\d\s.-]{7,30}$/.test(f.phone.trim())) {
        this.showError('Enter a valid mobile number.', '[name="phone"]');
        return;
      }
      if (f.dietary === 'Other' && !f.dietaryOther.trim()) {
        this.showError('Please specify your dietary requirement.', '[name="dietaryOther"]');
        return;
      }
      if (!f.registrationConsent) {
        this.showError('Please read and accept the Privacy & POPIA Notice to register.', '[name="registrationConsent"]');
        return;
      }
      if (!f.playerDataConsent) {
        this.showError("Please confirm that you may provide the listed players' details.", '[name="playerDataConsent"]');
        return;
      }
      if (!this.state.online) {
        this.showError('You are offline. Reconnect, then send your entry again.', '[data-submit-block]');
        return;
      }
      const players = [];
      for (let i = 0; i < f.qty * 4; i++) {
        const p = f.players[i] || {};
        players.push({ name: p.name || '', handicap: p.hcp || '' });
      }
  
      this.setState({ sending: true, error: '' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
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
        const message = error && error.name === 'AbortError'
          ? 'The connection took too long. Your details are still here. Please try again.'
          : error && error.message
            ? error.message
            : 'We could not save your entry. Please try again.';
        this.showError(message, '[data-submit-block]');
        return;
      } finally {
        clearTimeout(timeout);
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
      const essentialChecks = [
        !!f.company.trim(),
        !!f.contact.trim(),
        /^[+()\d\s.-]{7,30}$/.test(f.phone.trim()),
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()),
        f.registrationConsent,
        f.playerDataConsent
      ];
      if (f.dietary === 'Other') essentialChecks.push(!!f.dietaryOther.trim());
      const essentials = essentialChecks.filter(Boolean).length;
      const essentialTotal = essentialChecks.length;
      const progressValue = Math.round((essentials / essentialTotal) * 100);
  
      return {
        f, groups, done: this.state.done, sending: this.state.sending, error: this.state.error,
        offline: !this.state.online,
        submitDisabled: this.state.sending || this.state.done || !this.state.online,
        progressValue,
        progressWidth: `${progressValue}%`,
        progressLabel: progressValue === 100 ? 'Ready to send' : `${essentials} of ${essentialTotal} essentials`,
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

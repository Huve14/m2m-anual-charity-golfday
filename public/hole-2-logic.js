window.__dcLogicFactories = window.__dcLogicFactories || {};
window.__dcLogicFactories["hole-2"] = (DCLogic) => {
  class Component extends DCLogic {
    state = { flying: false, progress: 0 };
  
    componentDidMount() {
      const attach = () => {
        const el = document.querySelector('golf-stage');
        if (!el || !el.startFlythrough) { this._t = setTimeout(attach, 200); return; }
        this._stage = el;
        el.addEventListener('flystate', e => this.setState({ flying: e.detail.flying, progress: e.detail.flying ? 0 : this.state.progress }));
        el.addEventListener('flyprogress', e => {
          const p = e.detail.progress;
          // repaint the bar in ~1% steps rather than every frame
          if (Math.abs(p - this.state.progress) > 0.008 || p >= 1) this.setState({ progress: p });
        });
        this._key = ev => {
          if (ev.key === ' ') { ev.preventDefault(); this.toggle(); }
          if (ev.key === 'r' || ev.key === 'R') el.resetView();
        };
        window.addEventListener('keydown', this._key);
      };
      attach();
    }
  
    componentWillUnmount() {
      clearTimeout(this._t);
      if (this._key) window.removeEventListener('keydown', this._key);
    }
  
    toggle = () => {
      const el = this._stage || document.querySelector('golf-stage');
      if (!el || !el.startFlythrough) return;
      if (this.state.flying) el.stopFlythrough();
      else el.startFlythrough();
    };
  
    reset = () => {
      const el = this._stage || document.querySelector('golf-stage');
      if (el && el.resetView) { el.resetView(); this.setState({ progress: 0 }); }
    };
  
    renderVals() {
      const dash = '-';
      const spec = [
        { k: 'Hole', v: String(this.props.holeNumber ?? 2) },
        { k: 'Par', v: this.props.holePar || dash },
        { k: 'Length', v: this.props.holeLength || dash },
        { k: 'Stroke', v: this.props.holeIndex || dash }
      ];
      return {
        spec,
        note: this.props.holeNote ||
          'An interpretive 3D view of Glendower\'s second hole, from tee to green. Fly it before you play it.',
        flying: this.state.flying,
        flyLabel: this.state.flying ? 'Stop flythrough' : 'Fly the hole',
        flyGlyph: this.state.flying ? '\u25A0' : '\u25B6',
        flySeconds: 26,
        progressPct: `${Math.round(this.state.progress * 100)}%`,
        toggleFly: this.toggle,
        reset: this.reset,
        imgFail: e => { e.target.style.opacity = '0'; }
      };
    }
  }
  return Component;
};

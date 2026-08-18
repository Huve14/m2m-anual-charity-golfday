"use client";

import { FormEvent, useRef, useState } from "react";

const FORM_ENDPOINT =
  "https://docs.google.com/forms/u/0/d/e/1FAIpQLSfGurQDw1YMzAt_FQrvq5o3fa6933jxjz7hPag1tEtU6FZuAQ/formResponse";

const CONFIRMATION_TEXT =
  "I confirm that the information provided is correct and agree to be contacted about this M2M Golf Day registration.";

const fieldIds = {
  firstName: "entry.437593400",
  surname: "entry.399152369",
  email: "entry.1367203282",
  cell: "entry.1037039320",
  company: "entry.1907380092",
  fourBalls: "entry.368685638",
  players: "entry.277494656",
  requirements: "entry.1033228854",
  notes: "entry.1302663669",
  confirmation: "entry.912449741",
} as const;

function ArrowMark() {
  return (
    <span className="arrow-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function SectionHeading({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2>{children}</h2>
      <div aria-hidden="true" />
    </div>
  );
}

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.reportValidity()) return;

    const nativeData = new FormData(form);
    if (nativeData.get("website")) return;

    const submission = new FormData();
    for (const [key, value] of Object.entries(fieldIds)) {
      const formValue = nativeData.get(key);
      if (formValue) submission.append(value, formValue);
    }
    submission.append("fvv", "1");
    submission.append("pageHistory", "0");

    setStatus("sending");
    try {
      await fetch(FORM_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        body: submission,
      });
      form.reset();
      setStatus("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setStatus("error");
    }
  }

  function resetForm() {
    setStatus("idle");
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }

  return (
    <main>
      <header className="masthead">
        <div className="masthead-inner">
          <img
            className="brand-logo"
            src="/m2m-brand-header.png"
            alt="M2M — Marketing 2 The Max"
          />
          <div className="masthead-tagline">
            <ArrowMark />
            <span>Inspired execution</span>
          </div>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow"><span /> Charity Golf Day</p>
          <h1 id="page-title">Make your<br /><em>four-ball</em> count.</h1>
          <p className="hero-intro">
            Bring your team to the green for a day built around good company,
            generous spirit and a great cause.
          </p>
          <div className="hero-note">
            <span aria-hidden="true">01</span>
            <p>One four-ball accommodates up to four players.</p>
          </div>
        </div>

        <div className="golf-visual" aria-hidden="true">
          <div className="score-line score-line-one">PAR</div>
          <div className="score-line score-line-two">04</div>
          <div className="golf-ball" />
          <div className="red-chevron" />
          <div className="fairway-line" />
        </div>
      </section>

      <section className="form-shell" aria-label="Four-ball registration form">
        <div className="form-rail">
          <p>Register your team</p>
          <span>Complete the form below</span>
        </div>

        {status === "success" ? (
          <div className="success-card" role="status">
            <div className="success-icon" aria-hidden="true">✓</div>
            <p className="eyebrow"><span /> Registration sent</p>
            <h2>You’re on the leaderboard.</h2>
            <p>
              Thank you. Your four-ball registration has been recorded and the M2M team
              will use the details provided to follow up with you.
            </p>
            <button type="button" onClick={resetForm}>Register another four-ball</button>
          </div>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit} noValidate>
            <div className="form-intro">
              <div>
                <p className="form-kicker">M2M Golf Day</p>
                <h2>Four-ball registration</h2>
              </div>
              <p><span>*</span> Required fields</p>
            </div>

            <SectionHeading number="01">Your details</SectionHeading>
            <div className="field-grid">
              <label>
                <span>First name <b>*</b></span>
                <input name="firstName" type="text" autoComplete="given-name" required />
              </label>
              <label>
                <span>Surname <b>*</b></span>
                <input name="surname" type="text" autoComplete="family-name" required />
              </label>
              <label>
                <span>Email address <b>*</b></span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                <span>Cell phone number <b>*</b></span>
                <input
                  name="cell"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  pattern="[0-9+() .-]{7,20}"
                  title="Please enter a valid phone number"
                  required
                />
              </label>
              <label className="span-two">
                <span>Company / organisation <small>Optional</small></span>
                <input name="company" type="text" autoComplete="organization" />
              </label>
            </div>

            <SectionHeading number="02">Your four-ball</SectionHeading>
            <fieldset className="quantity-fieldset">
              <legend>How many four-balls would you like to book? <b>*</b></legend>
              <div className="quantity-options">
                {["1", "2", "3", "4", "5+"].map((value) => (
                  <label key={value}>
                    <input type="radio" name="fourBalls" value={value} required />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="textarea-field">
              <span>Player names and golf handicaps <small>Optional</small></span>
              <textarea
                name="players"
                rows={5}
                placeholder="e.g. Alex Smith — 12 handicap&#10;Jordan Lee — 18 handicap"
              />
              <small>Add each player on a new line. You can also send these details later.</small>
            </label>

            <SectionHeading number="03">Final details</SectionHeading>
            <div className="field-grid">
              <label className="textarea-field">
                <span>Dietary or accessibility requirements <small>Optional</small></span>
                <textarea name="requirements" rows={4} />
              </label>
              <label className="textarea-field">
                <span>Additional notes or questions <small>Optional</small></span>
                <textarea name="notes" rows={4} />
              </label>
            </div>

            <label className="confirmation">
              <input name="confirmation" type="checkbox" value={CONFIRMATION_TEXT} required />
              <span aria-hidden="true" />
              <p>{CONFIRMATION_TEXT} <b>*</b></p>
            </label>

            <label className="honeypot" aria-hidden="true">
              Website
              <input name="website" type="text" tabIndex={-1} autoComplete="off" />
            </label>

            {status === "error" && (
              <p className="error-message" role="alert">
                We couldn’t send the registration. Please check your connection and try again.
              </p>
            )}

            <div className="submit-row">
              <button type="submit" disabled={status === "sending"}>
                <span>{status === "sending" ? "Sending…" : "Submit registration"}</span>
                <ArrowMark />
              </button>
              <p>Your details are recorded in M2M’s linked Google response sheet.</p>
            </div>
          </form>
        )}
      </section>

      <footer>
        <img
          src="/m2m-brand-header.png"
          alt="M2M — Marketing 2 The Max"
        />
        <div>
          <span>Charity Golf Day</span>
          <p>Good golf. Great company. A better impact.</p>
        </div>
      </footer>
    </main>
  );
}

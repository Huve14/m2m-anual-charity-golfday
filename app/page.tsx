"use client";

import { FormEvent, useRef, useState } from "react";

const CONFIRMATION_TEXT =
  "I confirm that the information provided is correct and agree to be contacted about this M2M Golf Day registration.";

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
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [accountEmailStatus, setAccountEmailStatus] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [accountCredentials, setAccountCredentials] = useState<{
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.reportValidity()) return;

    const nativeData = new FormData(form);
    if (nativeData.get("website")) return;

    const fourballsValue = String(nativeData.get("fourBalls") || "1");
    const fourballs = fourballsValue === "5+" ? 5 : Number(fourballsValue);
    const firstName = String(nativeData.get("firstName") || "");
    const surname = String(nativeData.get("surname") || "");
    const sponsorship = String(nativeData.get("sponsorship") || "");
    const packageChoice =
      sponsorship === "with-alcohol" || sponsorship === "without-alcohol"
        ? "Four-ball + hole sponsorship"
        : "Four-ball package";

    const playerNames = String(nativeData.get("players") || "")
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, fourballs * 4)
      .map((name) => ({ name, handicap: "" }));

    setStatus("sending");
    try {
      setErrorMessage(null);
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: String(nativeData.get("company") || "Individual registration"),
          firstName,
          surname,
          contactName: `${firstName} ${surname}`.trim(),
          email: String(nativeData.get("email") || ""),
          cellPhone: String(nativeData.get("cell") || ""),
          packageChoice,
          dietary: String(nativeData.get("dietary") || ""),
          fourballs,
          players: playerNames,
          notes: String(nativeData.get("notes") || ""),
          sponsorship,
          consent: true,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        friendlyMessage?: string;
        reason?: string;
        autoAccount?: {
          status: string;
          userId?: string;
          reason?: string;
          username?: string;
          temporaryPassword?: string;
          registrationStatus?: string;
          emailStatus?: {
            status: string;
            reason?: string;
            providerResponse?: unknown;
          };
        };
        excel?: {
          status: string;
          reason?: string;
        };
        warnings?: string[] | null;
      };
      if (!response.ok || result?.ok === false) {
        throw new Error(
          result?.friendlyMessage || result?.message || "Registration failed",
        );
      }
      setWarnings(Array.isArray(result.warnings) ? result.warnings : null);
        if (result.autoAccount?.status && result.autoAccount.status !== "skipped") {
          setAccountStatus(
            result.autoAccount?.status === "error"
              ? `Registration details were saved, but Supabase sync failed: ${
                  result.autoAccount.reason || "unknown issue"
                }`
              : `Account ${result.autoAccount.status}: ${result.autoAccount.username || "username unavailable"}`,
          );
          if (result.autoAccount.username && result.autoAccount.temporaryPassword) {
            setAccountCredentials({
              username: result.autoAccount.username,
              temporaryPassword: result.autoAccount.temporaryPassword,
            });
          } else {
            setAccountCredentials(null);
          }
          if (result.autoAccount.emailStatus?.status === "sent") {
            setAccountEmailStatus("Login credentials have been emailed to the registrant.");
          } else if (result.autoAccount.emailStatus?.status === "skipped") {
            setAccountEmailStatus(
              "Email is not configured; temporary credentials are shown here for hand-off.",
            );
          } else if (result.autoAccount.emailStatus?.status === "error") {
            setAccountEmailStatus(
              `We could not email credentials: ${
                result.autoAccount.emailStatus.reason || "please contact support."
              }`,
            );
          } else {
            setAccountEmailStatus(null);
          }
        } else {
          setAccountStatus(null);
          setAccountCredentials(null);
          setAccountEmailStatus(null);
        }
      const excelResult = result.excel;
      if (excelResult?.status && excelResult.status !== "inserted") {
        setWarnings((previousWarnings) => {
          const list = [...(previousWarnings || [])];
          const detail = excelResult.reason
            ? `${excelResult.status}: ${excelResult.reason}`
            : `Excel sync: ${excelResult.status}`;
          if (list.includes(detail)) return list;
          list.push(detail);
          return list;
        });
      }
      form.reset();
      setStatus("success");
      setErrorMessage(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message || "We couldn’t send the registration. Please try again."
          : "We couldn’t send the registration. Please try again.",
      );
      setAccountStatus(null);
      setAccountEmailStatus(null);
      setWarnings(null);
      setAccountCredentials(null);
    }
  }

  function resetForm() {
    setStatus("idle");
    setAccountStatus(null);
    setAccountEmailStatus(null);
    setWarnings(null);
    setAccountCredentials(null);
    setErrorMessage(null);
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
          <div className="masthead-actions">
            <span className="masthead-tagline">Inspired execution</span>
            <a className="masthead-link" href="#registration">
              Register now
              <ArrowMark />
            </a>
          </div>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-content">
          <div className="hero-copy">
            <p className="hero-kicker"><span /> M2M Charity Golf Day</p>
            <h1 id="page-title">Drive change.<br /><em>Play with purpose.</em></h1>
            <p className="hero-intro">
              Rally your four-ball for a day where sharp play, generous spirit and
              meaningful impact share the same fairway.
            </p>
            <div className="hero-actions">
              <a className="hero-cta" href="#registration">
                <span>Register a four-ball</span>
                <ArrowMark />
              </a>
              <p><strong>4</strong> players per four-ball</p>
            </div>
            <dl className="hero-meta">
              <div>
                <dt>Format</dt>
                <dd>Four-ball</dd>
              </div>
              <div>
                <dt>Team size</dt>
                <dd>Up to four</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>Play for impact</dd>
              </div>
            </dl>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="hero-score">
              <span>Players</span>
              <strong>04</strong>
            </div>
            <div className="hero-art-caption">
              <span>Good golf</span>
              <strong>Greater impact.</strong>
            </div>
            <div className="hero-art-stripe">Charity Golf Day</div>
          </div>
        </div>
      </section>

      <section id="registration" className="form-shell" aria-label="Four-ball registration form">
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
            {accountStatus && <p>{accountStatus}</p>}
            {accountEmailStatus && <p className="credential-note">{accountEmailStatus}</p>}
            {warnings && warnings.length > 0 ? (
              <ul className="warning-list">
                {warnings.map((message, index) => (
                  <li key={`${message}-${index}`}>{message}</li>
                ))}
              </ul>
            ) : null}
            {accountCredentials ? (
              <p className="credential-block">
                Username: <strong>{accountCredentials.username}</strong> — Temporary
                password: <strong>{accountCredentials.temporaryPassword}</strong>
              </p>
            ) : null}
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
              <label>
                <span>Hole sponsorship</span>
                <select name="sponsorship" defaultValue="" required={false}>
                  <option value="">No hole sponsorship</option>
                  <option value="with-alcohol" disabled>
                    Hole sponsorship with alcohol (SOLD OUT)
                  </option>
                  <option value="without-alcohol">Hole sponsorship without alcohol</option>
                </select>
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
                <select name="dietary" defaultValue="" required={false}>
                  <option value="">Select an option</option>
                  <option value="No requirements">No dietary requirements</option>
                  <option value="Vegetarian">Vegetarian</option>
                  <option value="Vegan">Vegan</option>
                  <option value="Gluten-free">Gluten-free</option>
                  <option value="Halal">Halal</option>
                  <option value="Nut-free">Nut-free</option>
                  <option value="Other">Other (explain in notes)</option>
                </select>
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
                {errorMessage ??
                  "We couldn’t send the registration. Please check your connection and try again."}
              </p>
            )}

            <div className="submit-row">
              <button type="submit" disabled={status === "sending"}>
                <span>{status === "sending" ? "Sending…" : "Submit registration"}</span>
                <ArrowMark />
              </button>
              <p>Your details are recorded in M2M’s secure Excel registration workbook.</p>
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

"use client";

import { useEffect, useRef, useState } from "react";
import type { Reader } from "@/lib/store";

type Who = { kind: "reader"; id: string; name: string } | { kind: "parent" };

export interface LoginResult {
  ok: boolean;
  message?: string;
}

export function LoginScreen({ readers, onReader, onParent, onForgot }: {
  readers: Reader[];
  onReader: (id: string, pin: string) => Promise<LoginResult>;
  onParent: (pin: string) => Promise<LoginResult>;
  /** Parent only: clear every PIN and run setup again. The signed-in email is the proof of who is asking. */
  onForgot?: () => Promise<LoginResult>;
}) {
  const [who, setWho] = useState<Who | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (who) input.current?.focus();
  }, [who]);

  function pick(w: Who) {
    setWho(w);
    setPin("");
    setErr("");
    setConfirmReset(false);
  }

  async function forgot() {
    if (!onForgot || busy) return;
    setBusy(true);
    const res = await onForgot();
    setBusy(false);
    if (!res.ok) setErr(res.message ?? "Couldn't reset the PINs. Try again.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!who || busy) return;
    setBusy(true);
    const res = who.kind === "reader" ? await onReader(who.id, pin) : await onParent(pin);
    setBusy(false);
    if (!res.ok) {
      setErr(res.message ?? "That PIN doesn't match. Try again.");
      setPin("");
      input.current?.focus();
    }
  }

  return (
    <section className="stack">
      <div>
        <p className="label">Reading Coach</p>
        <h1>Who&rsquo;s here?</h1>
      </div>
      <div className="tiles">
        {readers.map((r) => (
          <button key={r.id} className="tile primary" type="button" onClick={() => pick({ kind: "reader", id: r.id, name: r.name })}>
            <span className="label" style={{ color: "var(--accent-ink)" }}>Reader</span>
            <span className="nm">{r.name}</span>
            <span>Tap to log in</span>
          </button>
        ))}
        <button className="tile" type="button" onClick={() => pick({ kind: "parent" })}>
          <span className="label">Grown-up</span>
          <span className="nm">Parent</span>
          <span className="muted">Progress and settings</span>
        </button>
      </div>
      {who && (
        <form className="card stack-sm" style={{ alignItems: "flex-start" }} onSubmit={submit}>
          <h3>{who.kind === "reader" ? `${who.name}, enter your PIN` : "Parent PIN"}</h3>
          <input ref={input} className="pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" aria-label="PIN"
            value={pin} onChange={(e) => setPin(e.target.value)} />
          <div className="row">
            <button className="primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Log in"}</button>
            <span className="err">{err}</span>
          </div>
          {who.kind === "parent" && onForgot && !confirmReset && (
            <button className="link" type="button" onClick={() => setConfirmReset(true)}>Forgot PIN?</button>
          )}
          {who.kind === "parent" && onForgot && confirmReset && (
            <div className="stack-sm" style={{ alignItems: "flex-start" }}>
              <p className="muted small">This clears the parent PIN and both reader PINs. You are signed in as the parent, so you will choose new ones on the setup screen next. Progress is kept.</p>
              <div className="row">
                <button className="danger" type="button" disabled={busy} onClick={() => void forgot()}>{busy ? "Resetting…" : "Reset all PINs"}</button>
                <button className="link" type="button" onClick={() => setConfirmReset(false)}>Keep them</button>
              </div>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

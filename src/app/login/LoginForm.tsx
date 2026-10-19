"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const LINK_ERRORS: Record<string, string> = {
  link: "That sign-in link didn't work. It may have been opened on a different device or browser than the one that asked for it. Request a new one here.",
  expired: "That sign-in link has expired. Request a new one.",
};

/** Parent sign-in: email magic link through Supabase Auth. Readers don't sign in; they use the parent's device. */
export function LoginForm({ configured, linkError }: { configured: boolean; linkError: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState(linkError ? LINK_ERRORS[linkError] ?? LINK_ERRORS.link : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setStatus("sending");
    setErr("");
    try {
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (ex) {
      setStatus("error");
      setErr(ex instanceof Error ? ex.message : "Couldn't send the link. Try again.");
    }
  }

  if (!configured) {
    return (
      <section className="card stack-sm">
        <p className="label">Reading Coach</p>
        <h1>Almost ready</h1>
        <p className="muted">Supabase isn&rsquo;t configured. Copy <code>.env.example</code> to <code>.env.local</code> and set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then restart. See the README for the Supabase setup.</p>
      </section>
    );
  }

  if (status === "sent") {
    return (
      <section className="card stack-sm">
        <p className="label">Reading Coach</p>
        <h1>Check your email</h1>
        <p>We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to sign in.</p>
        <p className="muted small">Nothing there? Check spam, or <button className="link" type="button" onClick={() => setStatus("idle")}>try again</button>.</p>
      </section>
    );
  }

  return (
    <form className="card stack-sm" style={{ alignItems: "flex-start" }} onSubmit={submit}>
      <p className="label">Reading Coach</p>
      <h1>Grown-up sign in</h1>
      <p className="muted">Enter the parent email address and we&rsquo;ll send a sign-in link. Once you&rsquo;re signed in on a device, each reader can tap her name and enter her PIN.</p>
      <label className="field" style={{ width: "100%", maxWidth: 360 }}>
        <span className="label">Email</span>
        <input type="email" inputMode="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary big" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send sign-in link"}</button>
        <span className="err">{err}</span>
      </div>
    </form>
  );
}

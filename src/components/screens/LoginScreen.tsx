"use client";

import { useEffect, useRef, useState } from "react";
import type { Reader } from "@/lib/store";

type Who = { kind: "reader"; id: string; name: string } | { kind: "parent" };

export function LoginScreen({ readers, onReader, onParent }: {
  readers: Reader[];
  onReader: (id: string, pin: string) => boolean;
  onParent: (pin: string) => boolean;
}) {
  const [who, setWho] = useState<Who | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (who) input.current?.focus();
  }, [who]);

  function pick(w: Who) {
    setWho(w);
    setPin("");
    setErr("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!who) return;
    const ok = who.kind === "reader" ? onReader(who.id, pin) : onParent(pin);
    if (!ok) {
      setErr("That PIN doesn't match. Try again.");
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
            <button className="primary" type="submit">Log in</button>
            <span className="err">{err}</span>
          </div>
        </form>
      )}
    </section>
  );
}

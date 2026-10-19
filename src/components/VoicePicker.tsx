"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getSavedVoiceURI, getSynth, listVoices, pitchFor, saveVoiceURI, voiceLabel, voiceTier, type VoiceTier } from "@/lib/speech";

const SAMPLE = "Hi! I'm Coach Juno. Let's read a story together. You've got this!";
const TIER_LABEL: Record<VoiceTier, string> = { natural: "Most natural", good: "Good", basic: "Basic" };

/** Pick which of the device's voices Juno uses. The choice is saved on this device only. */
export function VoicePicker() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const utter = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = getSynth();
    const load = () => { setVoices(listVoices()); setReady(true); };
    load();
    setSaved(getSavedVoiceURI());
    if (!synth) return;
    synth.addEventListener("voiceschanged", load);
    // Some browsers fill the list a moment after the page loads without firing the event.
    const t1 = window.setTimeout(load, 500);
    const t2 = window.setTimeout(load, 2000);
    return () => { synth.removeEventListener("voiceschanged", load); window.clearTimeout(t1); window.clearTimeout(t2); synth.cancel(); };
  }, []);

  function play(v: SpeechSynthesisVoice) {
    const synth = getSynth();
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(SAMPLE);
    utter.current = u;
    u.voice = v;
    u.rate = 0.95;
    u.pitch = pitchFor(v);
    u.onend = () => setPlaying(null);
    u.onerror = () => setPlaying(null);
    setPlaying(v.voiceURI);
    synth.speak(u);
  }

  function choose(v: SpeechSynthesisVoice | null) {
    saveVoiceURI(v ? v.voiceURI : null);
    setSaved(v ? v.voiceURI : null);
    setMsg(v ? `Saved. Juno will use ${v.name} on this device.` : "Saved. Juno will pick the best voice on this device.");
    if (v) play(v);
  }

  const best = voices[0] ?? null;
  const hasNatural = voices.some((v) => voiceTier(v) === "natural");
  const SHOW = 10;
  const shown = showAll ? voices : voices.slice(0, SHOW);

  return (
    <main className="wrap">
      <div className="row between">
        <div>
          <p className="label">Juno&rsquo;s voice</p>
          <h1>Pick a voice</h1>
        </div>
        <Link href="/"><button type="button">Back</button></Link>
      </div>

      <section className="card stack-sm">
        <p>Tap <b>Try</b> to hear a voice, then tap <b>Use this one</b>. The choice is saved on this device.</p>
        {!ready && <p className="muted">Looking for voices…</p>}
        {ready && voices.length === 0 && <p className="err">This browser has no voices for speaking out loud. Try Safari or Chrome.</p>}
        {msg && <p className="ok-text">{msg}</p>}
      </section>

      {voices.length > 0 && (
        <section className="card stack-sm">
          <div className="row between">
            <div>
              <h3>{saved ? "Your choice" : "Automatic"}</h3>
              <p className="muted small">{saved ? "Juno uses the voice you picked below." : best ? `Juno is using ${best.name}, the best voice found on this device.` : ""}</p>
            </div>
            {saved && <button type="button" onClick={() => choose(null)}>Back to automatic</button>}
          </div>
        </section>
      )}

      {voices.length > 0 && (
        <section className="card stack-sm">
          <h3>Voices on this device</h3>
          <div className="stack-sm" role="list">
            {shown.map((v) => {
              const tier = voiceTier(v);
              const isSaved = saved === v.voiceURI;
              const isAuto = !saved && best?.voiceURI === v.voiceURI;
              return (
                <div key={v.voiceURI} role="listitem" className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{voiceLabel(v)} {(isSaved || isAuto) && <span className="result-pill good" style={{ fontSize: ".8rem", marginLeft: 6 }}>{isSaved ? "Chosen" : "In use"}</span>}</div>
                    <div className="muted small">{TIER_LABEL[tier]}</div>
                  </div>
                  <div className="row">
                    <button type="button" onClick={() => play(v)} disabled={playing === v.voiceURI}>{playing === v.voiceURI ? "Playing…" : "Try"}</button>
                    <button type="button" className="primary" onClick={() => choose(v)} disabled={isSaved}>Use this one</button>
                  </div>
                </div>
              );
            })}
          </div>
          {voices.length > SHOW && (
            <div><button type="button" className="link" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${voices.length} voices`}</button></div>
          )}
        </section>
      )}

      <section className="card stack-sm">
        <h3>{hasNatural ? "Want an even better voice?" : "Get a more natural voice"}</h3>
        <p className="muted small">The voices here come from the device, so adding a better one takes a minute in its settings. Come back to this page afterwards.</p>
        <ul className="small" style={{ margin: 0, paddingLeft: "1.2em", display: "grid", gap: 6 }}>
          <li><b>iPad or iPhone:</b> Settings → Accessibility → Spoken Content → Voices → English. Tap <b>Ava</b>, <b>Zoe</b> or <b>Samantha</b> and download the <b>Premium</b> or <b>Enhanced</b> version. Then reopen Safari.</li>
          <li><b>Mac:</b> System Settings → Accessibility → Spoken Content → System voice → Manage Voices. Download <b>Ava (Premium)</b> or <b>Zoe (Premium)</b>.</li>
          <li><b>Windows:</b> open this page in Microsoft Edge, which has natural voices like <b>Aria</b> and <b>Jenny</b> built in.</li>
          <li><b>Chrome:</b> on a Mac it can use the Mac voices above; <b>Google US English</b> is a good built-in choice.</li>
        </ul>
        <p className="muted small">A later version gives Juno her own studio-quality voice that sounds the same on every device.</p>
      </section>
    </main>
  );
}

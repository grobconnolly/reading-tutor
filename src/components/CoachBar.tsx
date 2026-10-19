"use client";

import Link from "next/link";
import type { Coach } from "@/hooks/useCoach";

export function CoachBar({ coach }: { coach: Coach }) {
  return (
    <div className="coach">
      <div className={`face${coach.speaking ? " speaking" : ""}${coach.listening ? " listening" : ""}`} aria-hidden="true">
        <span className="mouth" />
      </div>
      <div className="bubble" aria-live="polite">
        <div className="who">Coach Juno</div>
        <div>{coach.text}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "none" }}>
        <button className="mute" type="button" onClick={coach.toggleMute} title="Turn the coach's voice on or off">
          {coach.muted ? "Voice off" : "Voice on"}
        </button>
        <Link href="/voice" className="mute" style={{ textAlign: "center", textDecoration: "none", fontSize: ".8rem", padding: ".4em .8em" }} title="Choose which voice Juno uses on this device">
          Change voice
        </Link>
      </div>
    </div>
  );
}

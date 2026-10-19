"use client";

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
      <button className="mute" type="button" onClick={coach.toggleMute} title="Turn the coach's voice on or off">
        {coach.muted ? "Voice off" : "Voice on"}
      </button>
    </div>
  );
}

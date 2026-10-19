"use client";

export interface ResultsView {
  kicker: string;
  title: string;
  stars: number;
  wcpm: number | null;
  /** Percent, 0..100. */
  acc: number;
  comp: number;
  compTotal: number;
  nextLabel: string;
  onNext: () => void;
  note?: string | null;
}

export function ResultsScreen({ view, onHome }: { view: ResultsView; onHome: () => void }) {
  return (
    <section className="card stack">
      <p className="label">{view.kicker}</p>
      <h2>{view.title}</h2>
      <div className="stars" aria-label={`${view.stars} of 3 stars`}>
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= view.stars ? "" : "off"}>★</span>
        ))}
      </div>
      <div className="stats">
        <div className="stat"><span className="label">Words per minute</span><b>{view.wcpm ?? "–"}</b></div>
        <div className="stat"><span className="label">Words read right</span><b>{view.acc}%</b></div>
        <div className="stat"><span className="label">Questions</span><b>{view.comp}/{view.compTotal}</b></div>
      </div>
      {view.note && <p className="note">{view.note}</p>}
      <div className="row">
        <button className="primary big" type="button" onClick={view.onNext}>{view.nextLabel}</button>
        <button className="big" type="button" onClick={onHome}>Home</button>
      </div>
    </section>
  );
}

"use client";

import { lastAzureScores, type AzureScores } from "@/lib/azureAlign";

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
  /** Azure's scores for the read (milestone 3). Until milestone 2 threads ReadResult.azure through, the reading screen leaves them in lastAzureScores(). */
  azure?: AzureScores | null;
}

export function ResultsScreen({ view, onHome }: { view: ResultsView; onHome: () => void }) {
  const azure = view.azure ?? lastAzureScores();
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
        {azure && (
          <>
            <div className="stat" title="Azure's pronunciation accuracy, 0 to 100"><span className="label">Pronunciation</span><b>{azure.accuracy}</b></div>
            <div className="stat" title="Azure's fluency score, 0 to 100"><span className="label">Fluency</span><b>{azure.fluency}</b></div>
            <div className="stat" title="Share of the words she reached that she read right"><span className="label">Completeness</span><b>{azure.completeness}%</b></div>
          </>
        )}
      </div>
      {view.note && <p className="note">{view.note}</p>}
      <div className="row">
        <button className="primary big" type="button" onClick={view.onNext}>{view.nextLabel}</button>
        <button className="big" type="button" onClick={onHome}>Home</button>
      </div>
    </section>
  );
}

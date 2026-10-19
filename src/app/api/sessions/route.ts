import { NextResponse } from "next/server";
import { sessionSaves } from "@/lib/scoring";
import { parseSessionPayload, planSessionSave } from "@/lib/sessionSave";
import { currentUserId, supabaseServer } from "@/lib/supabase/server";

/**
 * POST a finished session (see SessionPayload). Saves the session row, bumps trouble words, recomputes
 * the level (and records the baseline on the last story of a reading check), and updates the reward
 * week. Everything runs as the signed-in parent, so Row Level Security applies.
 */
export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const uid = await currentUserId(sb);
    if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const parsed = parseSessionPayload(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const p = parsed.payload;
    if (!sessionSaves(p.finishedPct)) return NextResponse.json({ error: "She read too little of the story to save it." }, { status: 400 });

    const { data: reader, error: rErr } = await sb.from("readers").select("id, level, weekly_goal").eq("id", p.readerId).maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!reader) return NextResponse.json({ error: "No such reader." }, { status: 404 });

    // Counted sessions from around this week, so the planner can count the week in Pacific time.
    const since = new Date(Date.parse(p.endedAt) - 9 * 24 * 60 * 60 * 1000).toISOString();
    const { data: counted, error: cErr } = await sb.from("sessions").select("ended_at").eq("reader_id", p.readerId).eq("counts_for_goal", true).gte("ended_at", since);
    if (cErr) throw new Error(cErr.message);

    const plan = planSessionSave(p, { level: reader.level as number, weeklyGoal: reader.weekly_goal as number }, (counted ?? []).map((r: { ended_at: string }) => r.ended_at));

    const { data: ins, error: iErr } = await sb.from("sessions").insert(plan.session).select("id, ended_at").single();
    if (iErr) throw new Error(`Couldn't save the session: ${iErr.message}`);

    const { error: tErr } = await sb.rpc("record_trouble_words", { p_reader_id: p.readerId, p_missed: p.missedWords, p_won: p.wonWords });
    if (tErr) throw new Error(`Couldn't update tricky words: ${tErr.message}`);

    let baseline: Record<string, unknown> | null = null;
    if (plan.baseline) {
      const { data: b, error: bErr } = await sb.from("baselines").insert({ reader_id: p.readerId, ...plan.baseline }).select("id, reader_id, date, level, wcpm, passage_ids").single();
      if (bErr) throw new Error(`Couldn't save the baseline: ${bErr.message}`);
      baseline = b;
    }
    if (plan.level !== plan.levelBefore || baseline) {
      const patch: Record<string, unknown> = { level: plan.level };
      if (baseline) patch.current_baseline_id = baseline.id;
      const { error: uErr } = await sb.from("readers").update(patch).eq("id", p.readerId);
      if (uErr) throw new Error(`Couldn't update the level: ${uErr.message}`);
    }
    if (plan.rewardWeek) {
      const { error: wErr } = await sb.from("reward_weeks").upsert({ reader_id: p.readerId, ...plan.rewardWeek }, { onConflict: "reader_id,week_start" });
      if (wErr) throw new Error(`Couldn't update the reward week: ${wErr.message}`);
      // Milestone 6: when goalCrossed and reward_weeks.notified_at is null, send the Brevo text/email and set notified_at.
    }

    return NextResponse.json({
      sessionId: ins.id,
      endedAt: ins.ended_at,
      stars: plan.stars,
      counts: plan.counts,
      levelBefore: plan.levelBefore,
      level: plan.level,
      countedBefore: plan.countedBefore,
      countedAfter: plan.countedAfter,
      goalCrossed: plan.goalCrossed,
      baseline,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save the session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

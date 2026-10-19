/*
 * Weekly reward wording. The reward is the parent's choice: cash (an amount in dollars) or a prize
 * (a label such as "a trip to the bookstore"). A prize never mentions money. Pure; unit-tested.
 */

export type RewardKind = "cash" | "prize";

export interface RewardInfo {
  rewardKind: RewardKind;
  /** Dollars, used when the kind is cash. */
  reward: number;
  /** What the prize is, used when the kind is prize. May be empty until the parent fills it in. */
  rewardLabel: string;
}

/** "a trip to the bookstore" -> "trip to the bookstore", so it can follow "your". */
export function stripArticle(label: string): string {
  return label.trim().replace(/^(a|an|the)\s+/i, "");
}

function label(r: RewardInfo): string {
  return r.rewardLabel.trim();
}

/** What Juno says she will earn: "5 dollars" | "your trip to the bookstore" | "your reward". */
export function rewardSpoken(r: RewardInfo): string {
  if (r.rewardKind === "cash") return `${r.reward} dollars`;
  const l = label(r);
  return l ? `your ${stripArticle(l)}` : "your reward";
}

/** With ownership, for "You already earned …": "your 5 dollars" | "your trip to the bookstore" | "your reward". */
export function rewardSpokenYours(r: RewardInfo): string {
  return r.rewardKind === "cash" ? `your ${r.reward} dollars` : rewardSpoken(r);
}

/* ---------- Juno's lines ---------- */

export function moreStoriesLine(r: RewardInfo, left: number): string {
  return `${left} more ${left === 1 ? "story" : "stories"} this week to earn ${rewardSpoken(r)}.`;
}

export function goalHitLine(r: RewardInfo): string {
  return `You hit your weekly goal! You earned ${rewardSpoken(r)}!`;
}

export function alreadyEarnedGreeting(r: RewardInfo, name: string): string {
  return `Hi ${name}! You already earned ${rewardSpokenYours(r)} this week. Keep reading to get even stronger!`;
}

/* ---------- reader home screen ---------- */

export function homeGoalHeading(r: RewardInfo, goal: number, won: boolean): string {
  if (r.rewardKind === "cash") {
    return won ? `Goal reached! You earned $${r.reward} this week.` : `Read ${goal} stories this week to earn $${r.reward}`;
  }
  const l = label(r);
  if (won) return l ? `Goal reached! You earned: ${l}` : "Goal reached! You earned your reward this week.";
  return l ? `Read ${goal} stories this week to earn: ${l}` : `Read ${goal} stories this week to earn your reward`;
}

/* ---------- parent view ---------- */

/** "earned $5" | "earned: a trip to the bookstore" | "earned: a reward". */
export function earnedShort(r: RewardInfo): string {
  if (r.rewardKind === "cash") return `earned $${r.reward}`;
  return `earned: ${label(r) || "a reward"}`;
}

/** "You owe $10 for 2 weeks" | "You owe 2 rewards (a trip to the bookstore) for 2 weeks". */
export function owedSummary(r: RewardInfo, weeks: number): string {
  const w = `${weeks} week${weeks === 1 ? "" : "s"}`;
  if (r.rewardKind === "cash") return `You owe $${r.reward * weeks} for ${w}`;
  const l = label(r);
  return `You owe ${weeks} reward${weeks === 1 ? "" : "s"}${l ? ` (${l})` : ""} for ${w}`;
}

export function markButton(r: RewardInfo): string {
  return r.rewardKind === "cash" ? "Mark as paid" : "Mark as given";
}

/** Past tense for the paid-weeks chips. */
export function paidWord(r: RewardInfo): string {
  return r.rewardKind === "cash" ? "paid" : "given";
}

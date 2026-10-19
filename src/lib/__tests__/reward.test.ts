import { describe, expect, it } from "vitest";
import { alreadyEarnedGreeting, earnedShort, goalHitLine, homeGoalHeading, markButton, moreStoriesLine, owedSummary, paidWord, rewardSpoken, stripArticle, type RewardInfo } from "../reward";

const cash: RewardInfo = { rewardKind: "cash", reward: 5, rewardLabel: "" };
const prize: RewardInfo = { rewardKind: "prize", reward: 5, rewardLabel: "a trip to the bookstore" };
const unnamed: RewardInfo = { rewardKind: "prize", reward: 5, rewardLabel: "  " };

describe("Juno's reward lines", () => {
  it("cash reads exactly as before", () => {
    expect(moreStoriesLine(cash, 3)).toBe("3 more stories this week to earn 5 dollars.");
    expect(moreStoriesLine(cash, 1)).toBe("1 more story this week to earn 5 dollars.");
    expect(goalHitLine(cash)).toBe("You hit your weekly goal! You earned 5 dollars!");
    expect(alreadyEarnedGreeting(cash, "Stella")).toBe("Hi Stella! You already earned your 5 dollars this week. Keep reading to get even stronger!");
  });
  it("a prize is spoken as 'your …' and never mentions money", () => {
    expect(moreStoriesLine(prize, 2)).toBe("2 more stories this week to earn your trip to the bookstore.");
    expect(goalHitLine(prize)).toBe("You hit your weekly goal! You earned your trip to the bookstore!");
    expect(alreadyEarnedGreeting(prize, "Penny")).toBe("Hi Penny! You already earned your trip to the bookstore this week. Keep reading to get even stronger!");
    for (const line of [moreStoriesLine(prize, 2), goalHitLine(prize), alreadyEarnedGreeting(prize, "Penny"), homeGoalHeading(prize, 5, false), homeGoalHeading(prize, 5, true)]) {
      expect(line).not.toMatch(/dollar|\$/);
    }
  });
  it("an unnamed prize is 'your reward'", () => {
    expect(rewardSpoken(unnamed)).toBe("your reward");
    expect(moreStoriesLine(unnamed, 4)).toBe("4 more stories this week to earn your reward.");
    expect(goalHitLine(unnamed)).toBe("You hit your weekly goal! You earned your reward!");
    expect(alreadyEarnedGreeting(unnamed, "Penny")).toBe("Hi Penny! You already earned your reward this week. Keep reading to get even stronger!");
  });
  it("drops a leading article so the label follows 'your'", () => {
    expect(stripArticle("a trip to the bookstore")).toBe("trip to the bookstore");
    expect(stripArticle("An ice cream")).toBe("ice cream");
    expect(stripArticle("the zoo")).toBe("zoo");
    expect(stripArticle("movie night")).toBe("movie night");
    expect(stripArticle("Theater tickets")).toBe("Theater tickets");
    expect(rewardSpoken({ ...prize, rewardLabel: "The Lego set" })).toBe("your Lego set");
  });
});

describe("home screen heading", () => {
  it("cash", () => {
    expect(homeGoalHeading(cash, 5, false)).toBe("Read 5 stories this week to earn $5");
    expect(homeGoalHeading(cash, 5, true)).toBe("Goal reached! You earned $5 this week.");
  });
  it("prize, named and unnamed", () => {
    expect(homeGoalHeading(prize, 5, false)).toBe("Read 5 stories this week to earn: a trip to the bookstore");
    expect(homeGoalHeading(prize, 5, true)).toBe("Goal reached! You earned: a trip to the bookstore");
    expect(homeGoalHeading(unnamed, 3, false)).toBe("Read 3 stories this week to earn your reward");
    expect(homeGoalHeading(unnamed, 3, true)).toBe("Goal reached! You earned your reward this week.");
  });
});

describe("parent view wording", () => {
  it("cash", () => {
    expect(earnedShort(cash)).toBe("earned $5");
    expect(owedSummary(cash, 1)).toBe("You owe $5 for 1 week");
    expect(owedSummary(cash, 3)).toBe("You owe $15 for 3 weeks");
    expect(markButton(cash)).toBe("Mark as paid");
    expect(paidWord(cash)).toBe("paid");
  });
  it("prize", () => {
    expect(earnedShort(prize)).toBe("earned: a trip to the bookstore");
    expect(earnedShort(unnamed)).toBe("earned: a reward");
    expect(owedSummary(prize, 1)).toBe("You owe 1 reward (a trip to the bookstore) for 1 week");
    expect(owedSummary(prize, 2)).toBe("You owe 2 rewards (a trip to the bookstore) for 2 weeks");
    expect(owedSummary(unnamed, 2)).toBe("You owe 2 rewards for 2 weeks");
    expect(markButton(prize)).toBe("Mark as given");
    expect(paidWord(prize)).toBe("given");
  });
});

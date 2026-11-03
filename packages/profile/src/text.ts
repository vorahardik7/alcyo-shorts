// The profile as it goes into every planner prompt (plan section 13). Text
// only: no media, no paths, no ids the agent could misuse.
import type { CreatorProfile } from "@alcyo/schema";

const MOMENT: Record<CreatorProfile["goodMoments"][number], string> = {
  funny: "funny",
  skill: "skill",
  rage: "rage",
  wholesome: "wholesome",
  story: "story",
  info: "info",
  "close-call": "close calls",
};
const PLATFORM = { tiktok: "TikTok", "youtube-shorts": "YouTube Shorts", reels: "Reels" } as const;

const sec = (ms: number) => {
  const v = ms / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export function profileText(p: CreatorProfile): string {
  const lines = ["# Creator profile"];
  const who = [p.name.length > 0 ? p.name : null, p.streams].filter((x) => x !== null).join(": ");
  lines.push(`Streams: ${who}${p.audience.length > 0 ? `. Viewers: ${p.audience}` : ""}`);
  lines.push(`Good moments: ${p.goodMoments.map((m) => MOMENT[m]).join(", ")}.`);
  const examples =
    p.exampleTitles.length > 0
      ? ` Examples: ${p.exampleTitles.map((t) => `"${t}"`).join(", ")}`
      : "";
  lines.push(
    `Length: ${sec(p.lengthMs.min)} to ${sec(p.lengthMs.max)} s. Titles: ${p.titleRules}${examples}`,
  );
  if (p.avoid.length > 0) lines.push(`Avoid: ${p.avoid.join(", ")}.`);
  lines.push(`Posts to: ${p.platforms.map((x) => PLATFORM[x]).join(", ")}.`);
  const st = p.style;
  const nums = [
    st.firstWordMs === undefined ? null : `first word within ${sec(st.firstWordMs)} s`,
    st.wordsPerSecond === undefined ? null : `${st.wordsPerSecond} words/s`,
    st.cutEveryMs === undefined ? null : `a cut every ${sec(st.cutEveryMs)} s`,
  ].filter((x) => x !== null);
  if (st.summary.length > 0 || nums.length > 0) {
    const from = st.sampleCount > 0 ? ` from ${st.sampleCount} past shorts` : "";
    lines.push(
      `Style${from}: ${st.summary}${nums.length > 0 ? ` Targets: ${nums.join("; ")}.` : ""}`.trim(),
    );
  }
  return lines.join("\n");
}

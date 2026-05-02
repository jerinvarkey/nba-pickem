// ESPN NBA scoreboard integration
// Match live games to our hardcoded series by team abbreviation pairs.

import { TEAMS, type Series } from "./bracket";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

export type LiveGame = {
  gameId: string;
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
  status: "scheduled" | "in_progress" | "final";
  statusDetail: string;
  startTime: string;
  seriesNote: string; // e.g. "Pistons lead series 3-2", "Series tied 3-3"
};

export async function fetchNBAScoreboard(): Promise<LiveGame[]> {
  try {
    const r = await fetch(SCOREBOARD_URL, { cache: "no-store" });
    if (!r.ok) return [];
    const d = await r.json();
    const events = (d?.events || []) as any[];
    const games: LiveGame[] = [];
    for (const ev of events) {
      const comp = ev?.competitions?.[0];
      if (!comp) continue;
      const cs = comp.competitors || [];
      const home = cs.find((c: any) => c.homeAway === "home");
      const away = cs.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;
      const stateRaw: string = ev?.status?.type?.state || "";
      const status: LiveGame["status"] =
        stateRaw === "in" ? "in_progress" : stateRaw === "post" ? "final" : "scheduled";
      const notes = (comp.notes || []) as any[];
      const seriesNote = notes.map((n: any) => n.headline || "").join(" • ");
      games.push({
        gameId: String(ev.id || comp.id || ""),
        awayAbbr: away.team?.abbreviation || "",
        homeAbbr: home.team?.abbreviation || "",
        awayScore: Number(away.score || 0),
        homeScore: Number(home.score || 0),
        status,
        statusDetail: ev?.status?.type?.shortDetail || "",
        startTime: ev?.date || comp.date || "",
        seriesNote,
      });
    }
    return games;
  } catch {
    return [];
  }
}

// Parse a series note like "Pistons lead series 3-2" or "Series tied 3-3" or "Magic win series 4-2"
// Returns series wins for the team whose city/name matches `winningName`, plus the other side's wins.
export function parseSeriesNote(
  note: string,
  highTeamName: string,
  lowTeamName: string
): { highWins: number; lowWins: number; winner: string | null } | null {
  if (!note) return null;
  const m = note.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  // Determine which side is leading from the wording
  const lower = note.toLowerCase();
  const tied = /tied/i.test(lower);
  const won = /(win|wins|won)\s+series/i.test(lower);
  const leads = /lead/i.test(lower);

  // First number is the leading/winning team's wins. If tied, both equal.
  if (tied) {
    return { highWins: a, lowWins: a, winner: null };
  }

  // Find which team's name appears first in the note - that's the leader.
  const idxHigh = lower.indexOf(highTeamName.toLowerCase());
  const idxLow = lower.indexOf(lowTeamName.toLowerCase());
  let highIsLeader = false;
  if (idxHigh >= 0 && idxLow >= 0) highIsLeader = idxHigh < idxLow;
  else if (idxHigh >= 0) highIsLeader = true;
  else if (idxLow >= 0) highIsLeader = false;
  else if (leads || won) return null; // can't determine

  const winner = won ? (highIsLeader ? highTeamName : lowTeamName) : null;
  if (highIsLeader) return { highWins: a, lowWins: b, winner: winner ? "high" : null };
  return { highWins: b, lowWins: a, winner: winner ? "low" : null };
}

// Match live games to series and produce updates
export type SeriesAutoUpdate = {
  seriesId: string;
  game1Started?: boolean;
  highWins?: number;
  lowWins?: number;
  winner?: string | null;
  statusDetail?: string;
};

export function matchGamesToSeries(games: LiveGame[], series: Series[]): SeriesAutoUpdate[] {
  const updates: SeriesAutoUpdate[] = [];
  for (const s of series) {
    if (!s.highSeed || !s.lowSeed) continue;
    const high = TEAMS[s.highSeed];
    const low = TEAMS[s.lowSeed];
    if (!high || !low) continue;
    const matching = games.filter((g) => {
      const pair = new Set([g.awayAbbr, g.homeAbbr]);
      return pair.has(high.abbr) && pair.has(low.abbr);
    });
    if (matching.length === 0) continue;

    // game1Started: any matched game is in progress or final
    const anyStarted = matching.some((g) => g.status === "in_progress" || g.status === "final");

    // Use the most informative series note (longest one usually has the latest count)
    const noteCandidate = matching
      .map((g) => g.seriesNote)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];

    let parsed: ReturnType<typeof parseSeriesNote> = null;
    if (noteCandidate) {
      parsed = parseSeriesNote(noteCandidate, high.name, low.name);
    }

    const update: SeriesAutoUpdate = { seriesId: s.id };
    if (anyStarted) update.game1Started = true;
    if (parsed) {
      update.highWins = parsed.highWins;
      update.lowWins = parsed.lowWins;
      // Determine winner if a side hit 4
      if (parsed.highWins >= 4) update.winner = high.key;
      else if (parsed.lowWins >= 4) update.winner = low.key;
    }
    // Most recent live status detail
    const liveOrFinal = matching.find((g) => g.status === "in_progress") || matching.find((g) => g.status === "final");
    if (liveOrFinal) update.statusDetail = liveOrFinal.statusDetail;

    updates.push(update);
  }
  return updates;
}

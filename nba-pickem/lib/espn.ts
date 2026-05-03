// ESPN NBA scoreboard integration.
// Strategy: pull every playoff-window game from ESPN, count game-level wins
// per matchup, and aggregate into series-level state. This avoids fragile
// "series note" string parsing and works for completed series too.

import { TEAMS, type Series } from "./bracket";

// 2026 playoffs began April 18.
const PLAYOFFS_START = "20260418";
const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

export type LiveGame = {
  gameId: string;
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number;
  homeScore: number;
  winnerAbbr: string | null; // null if not final
  status: "scheduled" | "in_progress" | "final";
  statusDetail: string;
  startTime: string;
};

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function today(): string {
  return fmtDate(new Date());
}

// One scoreboard fetch with optional date range.
async function fetchOneRange(dates: string): Promise<LiveGame[]> {
  try {
    const url = `${SCOREBOARD_URL}?dates=${dates}`;
    const r = await fetch(url, { cache: "no-store" });
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
      const homeAbbr = home.team?.abbreviation || "";
      const awayAbbr = away.team?.abbreviation || "";
      const homeScore = Number(home.score || 0);
      const awayScore = Number(away.score || 0);
      let winnerAbbr: string | null = null;
      if (status === "final") {
        if (home.winner === true) winnerAbbr = homeAbbr;
        else if (away.winner === true) winnerAbbr = awayAbbr;
        else if (homeScore > awayScore) winnerAbbr = homeAbbr;
        else if (awayScore > homeScore) winnerAbbr = awayAbbr;
      }
      games.push({
        gameId: String(ev.id || comp.id || ""),
        awayAbbr,
        homeAbbr,
        awayScore,
        homeScore,
        winnerAbbr,
        status,
        statusDetail: ev?.status?.type?.shortDetail || "",
        startTime: ev?.date || comp.date || "",
      });
    }
    return games;
  } catch {
    return [];
  }
}

// Pull all playoff-window games. Try the date range first; if ESPN ignores
// the range, fall back to fetching each day individually (slower but works).
export async function fetchNBAScoreboard(): Promise<LiveGame[]> {
  const range = `${PLAYOFFS_START}-${today()}`;
  let games = await fetchOneRange(range);
  if (games.length >= 2) return games; // got something useful

  // Fallback: walk day-by-day from playoffs start to today
  const start = new Date(2026, 3, 18); // April 18 2026
  const end = new Date();
  const collected: LiveGame[] = [];
  const seen = new Set<string>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const dayGames = await fetchOneRange(fmtDate(cursor));
    for (const g of dayGames) {
      if (!seen.has(g.gameId)) {
        seen.add(g.gameId);
        collected.push(g);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return collected;
}

export type SeriesAutoUpdate = {
  seriesId: string;
  game1Started?: boolean;
  highWins?: number;
  lowWins?: number;
  winner?: string | null;
  statusDetail?: string;
};

// Aggregate game-level wins into series state.
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

    let highWins = 0;
    let lowWins = 0;
    for (const g of matching) {
      if (g.status === "final" && g.winnerAbbr) {
        if (g.winnerAbbr === high.abbr) highWins++;
        else if (g.winnerAbbr === low.abbr) lowWins++;
      }
    }

    const anyStarted = matching.some((g) => g.status === "in_progress" || g.status === "final");
    let winner: string | null = null;
    if (highWins >= 4) winner = high.key;
    else if (lowWins >= 4) winner = low.key;

    const inProgress = matching.find((g) => g.status === "in_progress");
    const mostRecentFinal = matching
      .filter((g) => g.status === "final")
      .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""))[0];
    const nextScheduled = matching
      .filter((g) => g.status === "scheduled")
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))[0];
    const statusDetail = inProgress?.statusDetail || mostRecentFinal?.statusDetail || nextScheduled?.statusDetail || "";

    const update: SeriesAutoUpdate = { seriesId: s.id };
    if (anyStarted) update.game1Started = true;
    update.highWins = highWins;
    update.lowWins = lowWins;
    if (winner) update.winner = winner;
    if (statusDetail) update.statusDetail = statusDetail;
    updates.push(update);
  }
  return updates;
}

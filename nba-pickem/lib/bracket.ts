// 2026 NBA Playoffs - hardcoded seeds & first round matchups
// Seeds stay with the team through every round (no reseeding for points)

export type Conference = "East" | "West";
export type RoundKey = "r1" | "r2" | "cf" | "finals";

export type Team = {
  key: string;
  name: string;
  city: string;
  abbr: string;
  seed: number;
  conference: Conference;
  record?: string;
};

export const TEAMS: Record<string, Team> = {
  // East
  pistons:   { key: "pistons",   name: "Pistons",     city: "Detroit",      abbr: "DET", seed: 1, conference: "East", record: "60-22" },
  celtics:   { key: "celtics",   name: "Celtics",     city: "Boston",       abbr: "BOS", seed: 2, conference: "East", record: "56-26" },
  knicks:    { key: "knicks",    name: "Knicks",      city: "New York",     abbr: "NYK", seed: 3, conference: "East", record: "53-29" },
  cavaliers: { key: "cavaliers", name: "Cavaliers",   city: "Cleveland",    abbr: "CLE", seed: 4, conference: "East", record: "52-30" },
  raptors:   { key: "raptors",   name: "Raptors",     city: "Toronto",      abbr: "TOR", seed: 5, conference: "East", record: "46-36" },
  hawks:     { key: "hawks",     name: "Hawks",       city: "Atlanta",      abbr: "ATL", seed: 6, conference: "East", record: "46-36" },
  sixers:    { key: "sixers",    name: "76ers",       city: "Philadelphia", abbr: "PHI", seed: 7, conference: "East", record: "45-37" },
  magic:     { key: "magic",     name: "Magic",       city: "Orlando",      abbr: "ORL", seed: 8, conference: "East", record: "45-37" },
  // West
  thunder:   { key: "thunder",   name: "Thunder",     city: "Oklahoma City",abbr: "OKC", seed: 1, conference: "West", record: "65-17" },
  spurs:     { key: "spurs",     name: "Spurs",       city: "San Antonio",  abbr: "SAS", seed: 2, conference: "West" },
  nuggets:   { key: "nuggets",   name: "Nuggets",     city: "Denver",       abbr: "DEN", seed: 3, conference: "West" },
  lakers:    { key: "lakers",    name: "Lakers",      city: "Los Angeles",  abbr: "LAL", seed: 4, conference: "West" },
  rockets:   { key: "rockets",   name: "Rockets",     city: "Houston",      abbr: "HOU", seed: 5, conference: "West" },
  timberwolves: { key: "timberwolves", name: "Timberwolves", city: "Minnesota", abbr: "MIN", seed: 6, conference: "West" },
  blazers:   { key: "blazers",   name: "Trail Blazers", city: "Portland",   abbr: "POR", seed: 7, conference: "West" },
  suns:      { key: "suns",      name: "Suns",        city: "Phoenix",      abbr: "PHX", seed: 8, conference: "West" },
};

export type Series = {
  id: string;            // stable forever - never derived from API
  round: RoundKey;
  conference: Conference | "Finals";
  bracketSlot: number;   // for ordering
  highSeed: string | null; // team key, null if TBD
  lowSeed: string | null;
  // Lineage: for r2/cf/finals, which series feed into this slot
  fromHigh?: string;     // series id whose winner becomes high seed
  fromLow?: string;
  // Series result tracking (from ESPN or admin)
  highWins?: number;
  lowWins?: number;
  winner?: string | null;
  game1Started?: boolean; // toggles the lock
};

// Round 1 - exact matchups from the 2026 bracket
export const INITIAL_SERIES: Series[] = [
  // East R1
  { id: "r1-e-1v8", round: "r1", conference: "East", bracketSlot: 1, highSeed: "pistons",   lowSeed: "magic" },
  { id: "r1-e-4v5", round: "r1", conference: "East", bracketSlot: 2, highSeed: "cavaliers", lowSeed: "raptors" },
  { id: "r1-e-3v6", round: "r1", conference: "East", bracketSlot: 3, highSeed: "knicks",    lowSeed: "hawks" },
  { id: "r1-e-2v7", round: "r1", conference: "East", bracketSlot: 4, highSeed: "celtics",   lowSeed: "sixers" },
  // West R1
  { id: "r1-w-1v8", round: "r1", conference: "West", bracketSlot: 5, highSeed: "thunder",   lowSeed: "suns" },
  { id: "r1-w-4v5", round: "r1", conference: "West", bracketSlot: 6, highSeed: "lakers",    lowSeed: "rockets" },
  { id: "r1-w-3v6", round: "r1", conference: "West", bracketSlot: 7, highSeed: "nuggets",   lowSeed: "timberwolves" },
  { id: "r1-w-2v7", round: "r1", conference: "West", bracketSlot: 8, highSeed: "spurs",     lowSeed: "blazers" },

  // Conference Semis (lineage based on r1)
  { id: "r2-e-A", round: "r2", conference: "East", bracketSlot: 1, highSeed: null, lowSeed: null, fromHigh: "r1-e-1v8", fromLow: "r1-e-4v5" },
  { id: "r2-e-B", round: "r2", conference: "East", bracketSlot: 2, highSeed: null, lowSeed: null, fromHigh: "r1-e-3v6", fromLow: "r1-e-2v7" },
  { id: "r2-w-A", round: "r2", conference: "West", bracketSlot: 3, highSeed: null, lowSeed: null, fromHigh: "r1-w-1v8", fromLow: "r1-w-4v5" },
  { id: "r2-w-B", round: "r2", conference: "West", bracketSlot: 4, highSeed: null, lowSeed: null, fromHigh: "r1-w-3v6", fromLow: "r1-w-2v7" },

  // Conference Finals
  { id: "cf-e", round: "cf", conference: "East", bracketSlot: 1, highSeed: null, lowSeed: null, fromHigh: "r2-e-A", fromLow: "r2-e-B" },
  { id: "cf-w", round: "cf", conference: "West", bracketSlot: 2, highSeed: null, lowSeed: null, fromHigh: "r2-w-A", fromLow: "r2-w-B" },

  // NBA Finals
  { id: "finals", round: "finals", conference: "Finals", bracketSlot: 1, highSeed: null, lowSeed: null, fromHigh: "cf-e", fromLow: "cf-w" },
];

export const ROUND_INFO: Record<RoundKey, { label: string; basePoints: number; short: string }> = {
  r1:     { label: "First Round",        basePoints: 1, short: "R1" },
  r2:     { label: "Conference Semis",   basePoints: 2, short: "R2" },
  cf:     { label: "Conference Finals",  basePoints: 4, short: "CF" },
  finals: { label: "NBA Finals",         basePoints: 8, short: "F"  },
};

export const PLAYERS = [
  "Jerin", "Jaison", "Jason", "Jeffery", "Jijesh", "Jogi",
  "Jubee", "Nelson", "Nithen", "Renjith", "Rohith", "Subin",
];

// Resolve advancing teams into later-round slots based on r1/r2/cf winners
// "High seed" of the new slot = the better-seeded of the two advancers
export function resolveBracket(series: Series[]): Series[] {
  const map = new Map(series.map((s) => [s.id, { ...s }]));
  // Pass 1: r2 from r1 winners
  // Pass 2: cf from r2 winners
  // Pass 3: finals from cf winners
  const resolveSlot = (slot: Series) => {
    if (!slot.fromHigh || !slot.fromLow) return;
    const a = map.get(slot.fromHigh)?.winner;
    const b = map.get(slot.fromLow)?.winner;
    if (!a || !b) {
      slot.highSeed = null;
      slot.lowSeed = null;
      return;
    }
    const ta = TEAMS[a];
    const tb = TEAMS[b];
    if (!ta || !tb) return;
    // Within a conference, lower seed number is "high seed". For finals, treat E winner as "high" arbitrarily.
    if (slot.conference === "Finals") {
      const east = ta.conference === "East" ? ta : tb;
      const west = ta.conference === "West" ? ta : tb;
      slot.highSeed = east.key;
      slot.lowSeed = west.key;
    } else {
      if (ta.seed <= tb.seed) { slot.highSeed = ta.key; slot.lowSeed = tb.key; }
      else                    { slot.highSeed = tb.key; slot.lowSeed = ta.key; }
    }
  };
  ["r2-e-A","r2-e-B","r2-w-A","r2-w-B","cf-e","cf-w","finals"].forEach((id) => {
    const s = map.get(id);
    if (s) resolveSlot(s);
  });
  return Array.from(map.values()).sort((a, b) => {
    const ord: Record<RoundKey, number> = { r1: 0, r2: 1, cf: 2, finals: 3 };
    if (ord[a.round] !== ord[b.round]) return ord[a.round] - ord[b.round];
    return a.bracketSlot - b.bracketSlot;
  });
}

// Points if the picked team wins this series
export function computePoints(round: RoundKey, pickedTeamKey: string): number {
  const team = TEAMS[pickedTeamKey];
  if (!team) return 0;
  return ROUND_INFO[round].basePoints + team.seed;
}

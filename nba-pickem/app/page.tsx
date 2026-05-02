"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  TEAMS, ROUND_INFO, PLAYERS, INITIAL_SERIES, resolveBracket, computePoints,
  type Series, type RoundKey, type Team,
} from "@/lib/bracket";
import { supabase, hasSupabase } from "@/lib/supabase";
import { fetchNBAScoreboard, matchGamesToSeries } from "@/lib/espn";

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "stgs2026";
const ESPN_POLL_INTERVAL = 60_000; // 60s

type SeriesState = {
  highWins: number;
  lowWins: number;
  winner: string | null;
  game1Started: boolean;
  unlocked: boolean; // admin override
};

type AllPicks = Record<string /* player */, Record<string /* seriesId */, string /* teamKey */>>;

const defaultSeriesState: SeriesState = {
  highWins: 0, lowWins: 0, winner: null, game1Started: false, unlocked: false,
};

export default function HomePage() {
  const [tab, setTab] = useState<"r1" | "r2" | "cf" | "finals" | "leaderboard" | "rules" | "all-picks" | "bulk">("r1");
  const [currentPlayer, setCurrentPlayer] = useState<string>("");
  const [picks, setPicks] = useState<AllPicks>({});
  const [seriesState, setSeriesState] = useState<Record<string, SeriesState>>({});
  const [adminMode, setAdminMode] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPlayerLogin, setShowPlayerLogin] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [liveStatus, setLiveStatus] = useState<Record<string, string>>({}); // seriesId -> "Q3 4:22"
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  // Refs let the ESPN polling loop see latest state/updater without re-subscribing
  const seriesStateRef = useRef<Record<string, SeriesState>>({});
  const updateSeriesStateRef = useRef<(id: string, updates: Partial<SeriesState>) => void>(() => {});

  // Restore session
  useEffect(() => {
    if (typeof window === "undefined") return;
    const a = localStorage.getItem("nba_admin");
    if (a === "1") setAdminMode(true);
    const p = localStorage.getItem("nba_player");
    const auth = localStorage.getItem("nba_player_auth");
    // Restore player only if authenticated, OR if admin (admin can pick as anyone)
    if (p && PLAYERS.includes(p) && (auth === "1" || a === "1")) {
      setCurrentPlayer(p);
    }
  }, []);

  // Load picks + series state from Supabase (or in-memory fallback)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasSupabase || !supabase) {
        setLoaded(true);
        return;
      }
      const { data: pickRows } = await supabase.from("nba_picks").select("*");
      const { data: stateRows } = await supabase.from("nba_series_state").select("*");
      if (cancelled) return;
      const allPicks: AllPicks = {};
      (pickRows || []).forEach((r: any) => {
        if (!allPicks[r.player]) allPicks[r.player] = {};
        allPicks[r.player][r.series_id] = r.team_key;
      });
      const states: Record<string, SeriesState> = {};
      (stateRows || []).forEach((r: any) => {
        states[r.series_id] = {
          highWins: r.high_wins ?? 0,
          lowWins: r.low_wins ?? 0,
          winner: r.winner ?? null,
          game1Started: !!r.game1_started,
          unlocked: !!r.unlocked,
        };
      });
      setPicks(allPicks);
      setSeriesState(states);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll ESPN for live game data
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const games = await fetchNBAScoreboard();
      if (cancelled) return;
      const built = INITIAL_SERIES.map((s) => {
        const st = seriesStateRef.current[s.id];
        return st
          ? { ...s, highWins: st.highWins, lowWins: st.lowWins, winner: st.winner ?? undefined, game1Started: st.game1Started }
          : s;
      });
      const resolved = resolveBracket(built);
      const updates = matchGamesToSeries(games, resolved);
      const newLive: Record<string, string> = {};
      for (const u of updates) {
        if (u.statusDetail) newLive[u.seriesId] = u.statusDetail;
        const cur = seriesStateRef.current[u.seriesId];
        const desired: Partial<SeriesState> = {};
        if (u.game1Started && !cur?.game1Started) desired.game1Started = true;
        if (typeof u.highWins === "number" && u.highWins !== (cur?.highWins ?? 0)) desired.highWins = u.highWins;
        if (typeof u.lowWins === "number" && u.lowWins !== (cur?.lowWins ?? 0)) desired.lowWins = u.lowWins;
        if (u.winner && u.winner !== (cur?.winner ?? null)) desired.winner = u.winner;
        if (Object.keys(desired).length > 0) {
          // fire-and-forget; updateSeriesState persists
          updateSeriesStateRef.current(u.seriesId, desired);
        }
      }
      setLiveStatus(newLive);
      setLastFetch(new Date());
      timer = setTimeout(tick, ESPN_POLL_INTERVAL);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Build the resolved bracket from initial + saved series state
  const series: Series[] = useMemo(() => {
    const merged = INITIAL_SERIES.map((s) => {
      const st = seriesState[s.id];
      return st ? { ...s, highWins: st.highWins, lowWins: st.lowWins, winner: st.winner ?? undefined, game1Started: st.game1Started } : s;
    });
    return resolveBracket(merged);
  }, [seriesState]);

  const isLocked = useCallback(
    (seriesId: string) => {
      const st = seriesState[seriesId];
      if (!st) return false;
      if (st.unlocked) return false; // admin override
      return !!st.game1Started || !!st.winner;
    },
    [seriesState]
  );

  const setPick = async (seriesId: string, teamKey: string) => {
    if (!currentPlayer) {
      flashToast("Pick a player first");
      return;
    }
    if (isLocked(seriesId) && !adminMode) {
      flashToast("This series is locked");
      return;
    }
    setPicks((prev) => ({
      ...prev,
      [currentPlayer]: { ...(prev[currentPlayer] || {}), [seriesId]: teamKey },
    }));
    if (hasSupabase && supabase) {
      const { error } = await supabase
        .from("nba_picks")
        .upsert({ player: currentPlayer, series_id: seriesId, team_key: teamKey }, { onConflict: "player,series_id" });
      if (error) flashToast("Save failed - check Supabase");
    }
  };

  // Bulk save: write many picks for many players at once. Admin-only path.
  const bulkSavePicks = async (entries: { player: string; seriesId: string; teamKey: string }[]) => {
    if (entries.length === 0) {
      flashToast("Nothing to save");
      return;
    }
    // Update local state first
    setPicks((prev) => {
      const next: AllPicks = { ...prev };
      for (const e of entries) {
        next[e.player] = { ...(next[e.player] || {}), [e.seriesId]: e.teamKey };
      }
      return next;
    });
    if (hasSupabase && supabase) {
      const rows = entries.map((e) => ({ player: e.player, series_id: e.seriesId, team_key: e.teamKey }));
      const { error } = await supabase.from("nba_picks").upsert(rows, { onConflict: "player,series_id" });
      if (error) {
        flashToast("Save failed - check Supabase");
        return;
      }
    }
    flashToast(`Saved ${entries.length} pick${entries.length === 1 ? "" : "s"}`);
  };

  const updateSeriesState = async (seriesId: string, updates: Partial<SeriesState>) => {
    setSeriesState((prev) => {
      const next = { ...prev, [seriesId]: { ...defaultSeriesState, ...prev[seriesId], ...updates } };
      return next;
    });
    if (hasSupabase && supabase) {
      const merged = { ...defaultSeriesState, ...seriesState[seriesId], ...updates };
      const { error } = await supabase.from("nba_series_state").upsert(
        {
          series_id: seriesId,
          high_wins: merged.highWins,
          low_wins: merged.lowWins,
          winner: merged.winner,
          game1_started: merged.game1Started,
          unlocked: merged.unlocked,
        },
        { onConflict: "series_id" }
      );
      if (error) flashToast("Save failed - check Supabase");
    }
  };

  // Keep refs in sync for the ESPN polling loop
  useEffect(() => { seriesStateRef.current = seriesState; }, [seriesState]);
  useEffect(() => { updateSeriesStateRef.current = updateSeriesState; });

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  // Player login: password is the player's name (case-insensitive)
  const handlePlayerLogin = (name: string, password: string): boolean => {
    if (!PLAYERS.includes(name)) return false;
    if (password.trim().toLowerCase() !== name.toLowerCase()) return false;
    setCurrentPlayer(name);
    localStorage.setItem("nba_player", name);
    localStorage.setItem("nba_player_auth", "1");
    return true;
  };

  const handlePlayerLogout = () => {
    setCurrentPlayer("");
    localStorage.removeItem("nba_player");
    localStorage.removeItem("nba_player_auth");
    flashToast("Signed out");
  };

  // Admin can pick on behalf of anyone (no password needed once admin)
  const handleAdminPickAs = (name: string) => {
    setCurrentPlayer(name);
    if (name) localStorage.setItem("nba_player", name);
    else localStorage.removeItem("nba_player");
  };

  const handleAdminLogin = () => {
    if (adminInput === ADMIN_PASSWORD) {
      setAdminMode(true);
      localStorage.setItem("nba_admin", "1");
      setShowAdmin(false);
      setAdminInput("");
      flashToast("Admin mode on");
    } else {
      flashToast("Wrong password");
    }
  };

  const handleAdminLogout = () => {
    setAdminMode(false);
    localStorage.removeItem("nba_admin");
    flashToast("Admin mode off");
  };

  // Leaderboard
  const standings = useMemo(() => {
    return PLAYERS.map((p) => {
      let total = 0;
      let correct = 0;
      let made = 0;
      Object.entries(picks[p] || {}).forEach(([sid, teamKey]) => {
        made++;
        const s = series.find((x) => x.id === sid);
        if (!s || !s.winner) return;
        if (s.winner === teamKey) {
          total += computePoints(s.round, teamKey);
          correct++;
        }
      });
      return { player: p, total, correct, made };
    }).sort((a, b) => b.total - a.total || b.correct - a.correct);
  }, [picks, series]);

  // Shared rank for ties
  const rankedStandings = useMemo(() => {
    let rank = 0;
    let prev = -1;
    return standings.map((s, i) => {
      if (s.total !== prev) { rank = i + 1; prev = s.total; }
      return { ...s, rank };
    });
  }, [standings]);

  if (!loaded) {
    return (
      <div className="container">
        <div className="empty"><h4>Loading…</h4></div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="header">
        <div className="header-mark">ST. G&apos;S</div>
        <h1>NBA <em>Pick&apos;em</em> 2026</h1>
        <div className="header-sub">Series picks. Underdogs pay.</div>
      </header>

      {/* Login bar */}
      <div className="login-bar">
        {currentPlayer ? (
          <>
            <span className="login-status">
              Signed in as <strong>{currentPlayer}</strong>
              {adminMode && currentPlayer !== "" && <em style={{ color: "var(--text-muted)", fontStyle: "normal", marginLeft: 6 }}>(admin override)</em>}
            </span>
            {adminMode ? (
              <select value={currentPlayer} onChange={(e) => handleAdminPickAs(e.target.value)} title="Switch user (admin)">
                {PLAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={handlePlayerLogout}>Sign out</button>
            )}
          </>
        ) : (
          <>
            <span className="login-status">Sign in to make picks</span>
            <button className="btn btn-sm" onClick={() => setShowPlayerLogin(true)}>Sign in</button>
          </>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAdmin(true)} style={{ marginLeft: "auto" }}>
          {adminMode ? "Admin ✓" : "Admin"}
        </button>
        {adminMode && <button className="btn btn-ghost btn-sm" onClick={handleAdminLogout}>Sign out admin</button>}
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === "leaderboard" ? "active" : ""}`} onClick={() => setTab("leaderboard")}>Leaderboard</button>
        <button className={`tab ${tab === "r1" ? "active" : ""}`} onClick={() => setTab("r1")}>Round 1</button>
        <button className={`tab ${tab === "r2" ? "active" : ""}`} onClick={() => setTab("r2")}>Conf Semis</button>
        <button className={`tab ${tab === "cf" ? "active" : ""}`} onClick={() => setTab("cf")}>Conf Finals</button>
        <button className={`tab ${tab === "finals" ? "active" : ""}`} onClick={() => setTab("finals")}>NBA Finals</button>
        <button className={`tab ${tab === "all-picks" ? "active" : ""}`} onClick={() => setTab("all-picks")}>All Picks</button>
        {adminMode && <button className={`tab ${tab === "bulk" ? "active" : ""}`} onClick={() => setTab("bulk")} style={{ color: tab === "bulk" ? undefined : "var(--accent)" }}>Enter All Picks</button>}
        <button className={`tab ${tab === "rules" ? "active" : ""}`} onClick={() => setTab("rules")}>Rules</button>
      </div>

      {adminMode && tab !== "leaderboard" && tab !== "rules" && (
        <div className="admin-bar">
          <span className="label">Admin</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            You can change picks, set winners, lock/unlock series, and start/stop series.
          </span>
        </div>
      )}

      {tab === "r1" && <RoundView round="r1" series={series} picks={picks} currentPlayer={currentPlayer}
        seriesState={seriesState} liveStatus={liveStatus} adminMode={adminMode} onPick={setPick} onUpdateSeries={updateSeriesState} isLocked={isLocked} />}
      {tab === "r2" && <RoundView round="r2" series={series} picks={picks} currentPlayer={currentPlayer}
        seriesState={seriesState} liveStatus={liveStatus} adminMode={adminMode} onPick={setPick} onUpdateSeries={updateSeriesState} isLocked={isLocked} />}
      {tab === "cf" && <RoundView round="cf" series={series} picks={picks} currentPlayer={currentPlayer}
        seriesState={seriesState} liveStatus={liveStatus} adminMode={adminMode} onPick={setPick} onUpdateSeries={updateSeriesState} isLocked={isLocked} />}
      {tab === "finals" && <RoundView round="finals" series={series} picks={picks} currentPlayer={currentPlayer}
        seriesState={seriesState} liveStatus={liveStatus} adminMode={adminMode} onPick={setPick} onUpdateSeries={updateSeriesState} isLocked={isLocked} />}

      {tab === "leaderboard" && <Leaderboard standings={rankedStandings} />}
      {tab === "all-picks" && <AllPicks series={series} picks={picks} isLocked={isLocked} adminMode={adminMode} />}
      {tab === "bulk" && adminMode && <BulkEntry series={series} picks={picks} onBulkSave={bulkSavePicks} />}
      {tab === "rules" && <Rules />}

      {/* Admin login modal */}
      {showAdmin && !adminMode && (
        <div onClick={() => setShowAdmin(false)} style={{
          position: "fixed", inset: 0, background: "rgba(20,18,12,0.4)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1rem",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
            padding: "1.5rem", width: "100%", maxWidth: 380, boxShadow: "var(--shadow-lg)",
          }}>
            <h3 style={{ fontFamily: "Fraunces, serif", marginBottom: "1rem" }}>Admin login</h3>
            <input
              type="password" placeholder="Password" value={adminInput}
              onChange={(e) => setAdminInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
              style={{ width: "100%", padding: "0.6rem 0.85rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-alt)" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAdmin(false)}>Cancel</button>
              <button className="btn btn-sm" onClick={handleAdminLogin}>Sign in</button>
            </div>
          </div>
        </div>
      )}

      {/* Player login modal */}
      {showPlayerLogin && !currentPlayer && (
        <div onClick={() => setShowPlayerLogin(false)} style={{
          position: "fixed", inset: 0, background: "rgba(20,18,12,0.4)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1rem",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
            padding: "1.5rem", width: "100%", maxWidth: 380, boxShadow: "var(--shadow-lg)",
          }}>
            <h3 style={{ fontFamily: "Fraunces, serif", marginBottom: "0.4rem" }}>Sign in</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Your password is your name (case doesn&apos;t matter).
            </p>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: "0.3rem", textTransform: "uppercase", fontFamily: "Bebas Neue, sans-serif" }}>
              Name
            </label>
            <select
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              style={{ width: "100%", padding: "0.6rem 0.85rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-alt)", marginBottom: "0.85rem" }}
              autoFocus
            >
              <option value="">— Select your name —</option>
              {PLAYERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: "0.3rem", textTransform: "uppercase", fontFamily: "Bebas Neue, sans-serif" }}>
              Password
            </label>
            <input
              type="password" placeholder="Type your name" value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (handlePlayerLogin(loginName, loginPassword)) {
                    setShowPlayerLogin(false);
                    setLoginPassword("");
                    setLoginName("");
                    flashToast(`Welcome, ${loginName}`);
                  } else {
                    flashToast("Wrong password");
                  }
                }
              }}
              style={{ width: "100%", padding: "0.6rem 0.85rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card-alt)" }}
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowPlayerLogin(false); setLoginPassword(""); }}>Cancel</button>
              <button className="btn btn-sm" onClick={() => {
                if (handlePlayerLogin(loginName, loginPassword)) {
                  setShowPlayerLogin(false);
                  setLoginPassword("");
                  setLoginName("");
                  flashToast(`Welcome, ${loginName}`);
                } else {
                  flashToast("Wrong password");
                }
              }}>Sign in</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <footer className="footer">
        ST. G&apos;S NBA PICK&apos;EM • 2026 PLAYOFFS{!hasSupabase && " • LOCAL MODE (NO SUPABASE)"}
        {lastFetch && <> • LIVE SYNCED {lastFetch.toLocaleTimeString()}</>}
      </footer>
    </div>
  );
}

/* ---------------- ROUND VIEW ---------------- */

function RoundView({
  round, series, picks, currentPlayer, seriesState, liveStatus, adminMode, onPick, onUpdateSeries, isLocked,
}: {
  round: RoundKey;
  series: Series[];
  picks: AllPicks;
  currentPlayer: string;
  seriesState: Record<string, SeriesState>;
  liveStatus: Record<string, string>;
  adminMode: boolean;
  onPick: (seriesId: string, teamKey: string) => void;
  onUpdateSeries: (id: string, updates: Partial<SeriesState>) => void;
  isLocked: (id: string) => boolean;
}) {
  const list = series.filter((s) => s.round === round);
  const info = ROUND_INFO[round];

  if (list.length === 0) return null;

  return (
    <>
      <div className="section-title">
        <span>{info.label}</span>
        <span className="meta">{info.basePoints} + seed per correct pick</span>
      </div>
      <div className="series-grid">
        {list.map((s) => (
          <SeriesCard
            key={s.id}
            s={s}
            pick={currentPlayer ? picks[currentPlayer]?.[s.id] : undefined}
            state={seriesState[s.id]}
            liveStatus={liveStatus[s.id]}
            adminMode={adminMode}
            locked={isLocked(s.id)}
            onPick={onPick}
            onUpdate={onUpdateSeries}
          />
        ))}
      </div>
    </>
  );
}

/* ---------------- SERIES CARD ---------------- */

function SeriesCard({
  s, pick, state, liveStatus, adminMode, locked, onPick, onUpdate,
}: {
  s: Series;
  pick?: string;
  state?: SeriesState;
  liveStatus?: string;
  adminMode: boolean;
  locked: boolean;
  onPick: (seriesId: string, teamKey: string) => void;
  onUpdate: (id: string, updates: Partial<SeriesState>) => void;
}) {
  const high = s.highSeed ? TEAMS[s.highSeed] : null;
  const low = s.lowSeed ? TEAMS[s.lowSeed] : null;

  // TBD card
  if (!high || !low) {
    return (
      <div className="series-card">
        <div className="series-meta">
          <span>{s.conference} • {ROUND_INFO[s.round].label}</span>
          <span className="lock-pill">TBD</span>
        </div>
        <div style={{ padding: "1.25rem 0", textAlign: "center", color: "var(--text-muted)" }}>
          Waiting on previous round
        </div>
      </div>
    );
  }

  const winner = state?.winner ?? null;
  const showWinner = !!winner;

  const TeamRow = ({ team, isHigh }: { team: Team; isHigh: boolean }) => {
    const selected = pick === team.key;
    const isWinner = winner === team.key;
    const isLoser = !!winner && winner !== team.key;
    const points = ROUND_INFO[s.round].basePoints + team.seed;
    const cls = ["team-row"];
    if (isWinner) cls.push("winner");
    else if (selected) cls.push("selected");
    if ((locked && !adminMode) || showWinner) cls.push("disabled");
    if (isLoser) cls.push("disabled");

    return (
      <div className={cls.join(" ")} onClick={() => {
        if (showWinner) return;
        if (locked && !adminMode) return;
        onPick(s.id, team.key);
      }}>
        <div className="team-info">
          <span className="seed">{team.seed}</span>
          <div>
            <div className="team-name">{team.city} {team.name}</div>
            {team.record && <div className="team-record">{team.record}</div>}
          </div>
        </div>
        <span className="points-tag">+{points}</span>
      </div>
    );
  };

  return (
    <div className={`series-card ${locked ? "locked" : ""}`}>
      <div className="series-meta">
        <span>
          <span className={`conf-flag ${s.conference === "East" ? "east" : s.conference === "West" ? "west" : ""}`}>
            {s.conference}
          </span>
          {" "}• {ROUND_INFO[s.round].label}
        </span>
        {showWinner ? (
          <span className="lock-pill">FINAL</span>
        ) : locked ? (
          <span className="lock-pill">LOCKED</span>
        ) : (
          <span className="lock-pill open-pill">OPEN</span>
        )}
      </div>

      <div className="matchup">
        <TeamRow team={high} isHigh />
        <TeamRow team={low} isHigh={false} />
      </div>

      {(state?.highWins || state?.lowWins || liveStatus) ? (
        <div className="series-status">
          <span>{liveStatus || "Series"}</span>
          <span className="series-score">{high.abbr} {state?.highWins ?? 0} — {state?.lowWins ?? 0} {low.abbr}</span>
        </div>
      ) : null}

      {adminMode && (
        <div style={{ marginTop: "0.85rem", padding: "0.7rem", background: "var(--bg-subtle)", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: "0.4rem", fontSize: "0.82rem" }}>
          <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "var(--accent)", letterSpacing: "0.1em", marginRight: "0.4rem" }}>ADMIN</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(s.id, { game1Started: !state?.game1Started })}>
            {state?.game1Started ? "Mark Game 1 NOT started" : "Tip-off Game 1"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(s.id, { unlocked: !state?.unlocked })}>
            {state?.unlocked ? "Re-lock" : "Override unlock"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(s.id, { winner: high.key })}>
            {high.abbr} wins series
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(s.id, { winner: low.key })}>
            {low.abbr} wins series
          </button>
          {winner && <button className="btn btn-ghost btn-sm" onClick={() => onUpdate(s.id, { winner: null })}>Clear winner</button>}
          <input
            type="number" min={0} max={4} placeholder={`${high.abbr} W`} defaultValue={state?.highWins ?? 0}
            onBlur={(e) => onUpdate(s.id, { highWins: Number(e.target.value) || 0 })}
            style={{ width: 70, padding: "0.3rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)" }}
          />
          <input
            type="number" min={0} max={4} placeholder={`${low.abbr} W`} defaultValue={state?.lowWins ?? 0}
            onBlur={(e) => onUpdate(s.id, { lowWins: Number(e.target.value) || 0 })}
            style={{ width: 70, padding: "0.3rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)" }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- LEADERBOARD ---------------- */

function Leaderboard({ standings }: { standings: { player: string; total: number; correct: number; made: number; rank: number }[] }) {
  return (
    <>
      <div className="section-title">
        <span>Leaderboard</span>
        <span className="meta">Ties share a rank</span>
      </div>
      <div className="leaderboard">
        <div className="lb-row header">
          <span>RANK</span>
          <span>PLAYER</span>
          <span>PICKS</span>
          <span>POINTS</span>
        </div>
        {standings.map((s) => {
          const rankCls = s.rank === 1 ? "gold" : s.rank === 2 ? "silver" : s.rank === 3 ? "bronze" : "";
          return (
            <div className="lb-row" key={s.player}>
              <span className={`lb-rank ${rankCls}`}>{s.rank}</span>
              <span className="lb-name">{s.player}</span>
              <span className="lb-picks">{s.correct}/{s.made}</span>
              <span className="lb-points">{s.total}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- ALL PICKS ---------------- */

function AllPicks({
  series, picks, isLocked, adminMode,
}: {
  series: Series[];
  picks: AllPicks;
  isLocked: (id: string) => boolean;
  adminMode: boolean;
}) {
  return (
    <>
      <div className="section-title">
        <span>All Picks</span>
        <span className="meta">Hidden until series locks (admin sees all)</span>
      </div>
      <div className="picks-table-wrap">
        <table className="picks-table">
          <thead>
            <tr>
              <th>SERIES</th>
              {PLAYERS.map((p) => <th key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const high = s.highSeed ? TEAMS[s.highSeed] : null;
              const low = s.lowSeed ? TEAMS[s.lowSeed] : null;
              const label = high && low
                ? `${ROUND_INFO[s.round].short} ${high.abbr} v ${low.abbr}`
                : `${ROUND_INFO[s.round].short} TBD`;
              const locked = isLocked(s.id);
              const winner = s.winner;
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{label}</td>
                  {PLAYERS.map((p) => {
                    const pk = picks[p]?.[s.id];
                    if (!pk) return <td key={p} className="pick-cell empty">—</td>;
                    if (!locked && !adminMode) {
                      return <td key={p} className="pick-cell hidden-pick">✓</td>;
                    }
                    const team = TEAMS[pk];
                    let cls = "pick-cell";
                    if (winner) cls += pk === winner ? " correct" : " wrong";
                    return <td key={p} className={cls}>{team?.abbr ?? pk}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- BULK ENTRY (admin) ---------------- */

function BulkEntry({
  series, picks, onBulkSave,
}: {
  series: Series[];
  picks: AllPicks;
  onBulkSave: (entries: { player: string; seriesId: string; teamKey: string }[]) => Promise<void>;
}) {
  // Local draft state - only commits on Save
  const [draft, setDraft] = useState<AllPicks>(() => {
    // Seed from saved picks
    const out: AllPicks = {};
    for (const p of PLAYERS) out[p] = { ...(picks[p] || {}) };
    return out;
  });
  const [filterRound, setFilterRound] = useState<RoundKey | "all">("r1");
  const [saving, setSaving] = useState(false);

  // Visible series for the current round filter
  const visibleSeries = useMemo(
    () => series.filter((s) => (filterRound === "all" ? true : s.round === filterRound)).filter((s) => s.highSeed && s.lowSeed),
    [series, filterRound]
  );

  // Count unsaved changes vs `picks`
  const unsavedCount = useMemo(() => {
    let n = 0;
    for (const p of PLAYERS) {
      for (const sid of Object.keys(draft[p] || {})) {
        if (draft[p][sid] !== picks[p]?.[sid]) n++;
      }
    }
    return n;
  }, [draft, picks]);

  const setCell = (player: string, sid: string, teamKey: string) => {
    setDraft((prev) => ({
      ...prev,
      [player]: { ...(prev[player] || {}), [sid]: teamKey },
    }));
  };

  const fillRow = (player: string, side: "high" | "low") => {
    setDraft((prev) => {
      const next = { ...prev, [player]: { ...(prev[player] || {}) } };
      for (const s of visibleSeries) {
        const team = side === "high" ? s.highSeed : s.lowSeed;
        if (team) next[player][s.id] = team;
      }
      return next;
    });
  };

  const clearRow = (player: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      const cur = { ...(next[player] || {}) };
      for (const s of visibleSeries) delete cur[s.id];
      next[player] = cur;
      return next;
    });
  };

  const handleSave = async () => {
    const entries: { player: string; seriesId: string; teamKey: string }[] = [];
    for (const p of PLAYERS) {
      const cur = draft[p] || {};
      const saved = picks[p] || {};
      for (const sid of Object.keys(cur)) {
        if (cur[sid] && cur[sid] !== saved[sid]) {
          entries.push({ player: p, seriesId: sid, teamKey: cur[sid] });
        }
      }
    }
    if (entries.length === 0) return;
    setSaving(true);
    await onBulkSave(entries);
    setSaving(false);
  };

  const handleReset = () => {
    const out: AllPicks = {};
    for (const p of PLAYERS) out[p] = { ...(picks[p] || {}) };
    setDraft(out);
  };

  return (
    <>
      <div className="section-title">
        <span>Enter All Picks</span>
        <span className="meta">{unsavedCount} unsaved change{unsavedCount === 1 ? "" : "s"}</span>
      </div>

      <div className="admin-bar" style={{ marginBottom: "1rem" }}>
        <span className="label">Filter</span>
        {(["r1", "r2", "cf", "finals", "all"] as const).map((r) => (
          <button
            key={r}
            className={`btn btn-ghost btn-sm ${filterRound === r ? "" : ""}`}
            onClick={() => setFilterRound(r)}
            style={filterRound === r ? { background: "var(--text)", color: "var(--bg-card)", borderColor: "var(--text)" } : {}}
          >
            {r === "all" ? "All rounds" : ROUND_INFO[r as RoundKey].short}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={unsavedCount === 0}>
            Reset
          </button>
          <button className="btn btn-sm" onClick={handleSave} disabled={unsavedCount === 0 || saving}>
            {saving ? "Saving…" : `Save ${unsavedCount || ""}`}
          </button>
        </span>
      </div>

      <div className="picks-table-wrap">
        <table className="picks-table">
          <thead>
            <tr>
              <th style={{ position: "sticky", left: 0, zIndex: 2 }}>PLAYER</th>
              {visibleSeries.map((s) => {
                const high = s.highSeed ? TEAMS[s.highSeed] : null;
                const low = s.lowSeed ? TEAMS[s.lowSeed] : null;
                const winner = s.winner;
                return (
                  <th key={s.id} style={{ minWidth: 130 }}>
                    <div style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: "0.8rem", color: "var(--text)", letterSpacing: "normal", textTransform: "none" }}>
                      {high?.abbr} ({high?.seed}) v {low?.abbr} ({low?.seed})
                    </div>
                    <div style={{ fontSize: "0.7rem", marginTop: 2, color: winner ? "var(--green)" : "var(--text-muted)" }}>
                      {ROUND_INFO[s.round].short}
                      {winner && <> • {TEAMS[winner]?.abbr} won</>}
                    </div>
                  </th>
                );
              })}
              <th>TOOLS</th>
            </tr>
          </thead>
          <tbody>
            {PLAYERS.map((p) => (
              <tr key={p}>
                <td style={{ fontWeight: 600, position: "sticky", left: 0, background: "var(--bg-card)", borderRight: "1px solid var(--border)" }}>
                  {p}
                </td>
                {visibleSeries.map((s) => {
                  const high = s.highSeed ? TEAMS[s.highSeed] : null;
                  const low = s.lowSeed ? TEAMS[s.lowSeed] : null;
                  const cur = draft[p]?.[s.id] || "";
                  const dirty = cur !== (picks[p]?.[s.id] || "");
                  if (!high || !low) return <td key={s.id} className="pick-cell empty">—</td>;
                  return (
                    <td key={s.id}>
                      <select
                        value={cur}
                        onChange={(e) => setCell(p, s.id, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.35rem 0.4rem",
                          borderRadius: 6,
                          border: dirty ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                          background: dirty ? "var(--accent-soft)" : "var(--bg-card-alt)",
                          fontSize: "0.82rem",
                        }}
                      >
                        <option value="">—</option>
                        <option value={high.key}>{high.abbr} ({high.seed})</option>
                        <option value={low.key}>{low.abbr} ({low.seed})</option>
                      </select>
                    </td>
                  );
                })}
                <td>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => fillRow(p, "high")}
                      title="Fill all visible series with the higher seed"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}
                    >
                      All chalk
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => clearRow(p)}
                      title="Clear all visible picks for this player"
                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.72rem" }}
                    >
                      Clear
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "1rem", padding: "0.85rem 1.1rem", background: "var(--bg-card-alt)", borderRadius: 10, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        <strong>How this works:</strong> changes in this view are <em>local until you click Save</em>. Pink cells are unsaved edits. Picking is allowed even on locked series (admin override). Hit <strong>Save</strong> at the top to write everything to Supabase in one go.
      </div>
    </>
  );
}

/* ---------------- RULES ---------------- */

function Rules() {
  return (
    <>
      <div className="section-title"><span>Rules</span></div>
      <div className="rules-card">
        <h3>How it works</h3>
        <p>Pick the winner of every playoff series. You earn points only for correct picks. Picking lower seeds (underdogs) is worth more.</p>

        <h3>Signing in</h3>
        <p>Each player signs in with their name as both username and password (case doesn&apos;t matter). This keeps the wrong person from accidentally picking your games.</p>

        <h3>Scoring</h3>
        <table className="scoring-table">
          <thead>
            <tr><th>Round</th><th>Formula</th><th>Example</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>First Round</td>
              <td className="formula">1 + seed</td>
              <td>#1 Thunder = 2 pts • #8 Magic = 9 pts</td>
            </tr>
            <tr>
              <td>Conference Semis</td>
              <td className="formula">2 + seed</td>
              <td>#1 = 3 pts • #6 = 8 pts</td>
            </tr>
            <tr>
              <td>Conference Finals</td>
              <td className="formula">4 + seed</td>
              <td>#1 = 5 pts • #5 = 9 pts</td>
            </tr>
            <tr>
              <td>NBA Finals</td>
              <td className="formula">8 + seed</td>
              <td>#1 = 9 pts • #4 = 12 pts</td>
            </tr>
          </tbody>
        </table>

        <h3>Locking</h3>
        <p>Each series locks once Game 1 tips off. The app pulls live data from ESPN every minute and locks automatically when it sees Game 1 has started. Admin can override the lock if needed.</p>

        <h3>Visibility</h3>
        <p>Picks are hidden from other players until the series locks. You&apos;ll see a checkmark to confirm someone picked, but not what they picked.</p>

        <h3>Bracket</h3>
        <p>Seeds never change. If the #6 Wolves beat the #3 Nuggets and then beat the #2 Spurs, they&apos;re still the 6 seed in the conference finals.</p>
      </div>
    </>
  );
}

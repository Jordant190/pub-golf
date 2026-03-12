import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

const EMOJIS = ["🏌️", "🍺", "⛳", "🏆", "🎯", "🍻", "🤙", "👑"];
const TABS = ["Scorecard", "Setup", "Rules", "Leaderboard"];

// ─── helpers ──────────────────────────────────────────────────────────────────
function scoreKey(playerId, holeIdx) { return `${playerId}-${holeIdx}`; }

function buildDefaultGame() {
  return {
    holes: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, bar: `Bar ${i + 1}`, drink: "" })),
    players: [
      { id: 1, name: "Player 1", emoji: "🏌️" },
      { id: 2, name: "Player 2", emoji: "🍺" },
    ],
    rules: [
      { id: 1, text: "Using two hands to drink", penalty: 1 },
      { id: 2, text: "Spilling your drink", penalty: 2 },
      { id: 3, text: "Leaving the course early", penalty: 5 },
    ],
  };
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("Scorecard");
  const [game, setGame] = useState(buildDefaultGame());
  const [scores, setScores] = useState({}); // key → { sips, penalties }
  const [currentHole, setCurrentHole] = useState(0);
  const [status, setStatus] = useState("connecting"); // connecting | live | error
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newRuleText, setNewRuleText] = useState("");
  const [newRulePenalty, setNewRulePenalty] = useState(1);
  const [liveFlash, setLiveFlash] = useState(false);
  const debounceTimers = useRef({});

  // ── Load initial data ──
  useEffect(() => {
    async function load() {
      try {
        const [{ data: gameData }, { data: scoreData }] = await Promise.all([
          supabase.from("pub_golf_game").select("*").eq("id", "main").single(),
          supabase.from("pub_golf_scores").select("*"),
        ]);

        if (gameData) {
          setGame({ holes: gameData.holes, players: gameData.players, rules: gameData.rules });
        }
        if (scoreData) {
          const s = {};
          scoreData.forEach(row => { s[row.id] = { sips: row.sips, penalties: row.penalties }; });
          setScores(s);
        }
        setStatus("live");
      } catch (e) {
        setStatus("error");
      }
    }
    load();
  }, []);

  // ── Realtime subscriptions ──
  useEffect(() => {
    const gameSub = supabase
      .channel("game-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pub_golf_game" }, payload => {
        if (payload.new) {
          setGame({ holes: payload.new.holes, players: payload.new.players, rules: payload.new.rules });
          flashLive();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pub_golf_scores" }, payload => {
        if (payload.new) {
          setScores(prev => ({
            ...prev,
            [payload.new.id]: { sips: payload.new.sips, penalties: payload.new.penalties },
          }));
          flashLive();
        }
      })
      .subscribe(s => setStatus(s === "SUBSCRIBED" ? "live" : s === "CLOSED" ? "error" : "connecting"));

    return () => supabase.removeChannel(gameSub);
  }, []);

  function flashLive() {
    setLiveFlash(true);
    setTimeout(() => setLiveFlash(false), 800);
  }

  // ── Save game config (debounced) ──
  const saveGame = useCallback(async (nextGame) => {
    clearTimeout(debounceTimers.current.game);
    debounceTimers.current.game = setTimeout(async () => {
      await supabase.from("pub_golf_game").upsert({
        id: "main",
        holes: nextGame.holes,
        players: nextGame.players,
        rules: nextGame.rules,
        updated_at: new Date().toISOString(),
      });
    }, 400);
  }, []);

  // ── Save score (debounced) ──
  const saveScore = useCallback(async (playerId, holeIdx, data) => {
    const key = scoreKey(playerId, holeIdx);
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      await supabase.from("pub_golf_scores").upsert({
        id: key,
        player_id: String(playerId),
        hole_index: holeIdx,
        sips: data.sips,
        penalties: data.penalties,
        updated_at: new Date().toISOString(),
      });
    }, 300);
  }, []);

  // ── Score helpers ──
  function getScore(playerId, holeIdx) {
    return scores[scoreKey(playerId, holeIdx)] || { sips: 0, penalties: [] };
  }

  function setSips(playerId, holeIdx, val) {
    const sips = Math.max(0, parseInt(val) || 0);
    const key = scoreKey(playerId, holeIdx);
    const existing = scores[key] || { sips: 0, penalties: [] };
    const next = { ...existing, sips };
    setScores(prev => ({ ...prev, [key]: next }));
    saveScore(playerId, holeIdx, next);
  }

  function addPenalty(playerId, holeIdx, ruleId) {
    const rule = game.rules.find(r => r.id === ruleId);
    if (!rule) return;
    const key = scoreKey(playerId, holeIdx);
    const existing = scores[key] || { sips: 0, penalties: [] };
    const next = { ...existing, penalties: [...existing.penalties, { ruleId, penalty: rule.penalty, text: rule.text }] };
    setScores(prev => ({ ...prev, [key]: next }));
    saveScore(playerId, holeIdx, next);
  }

  function removePenalty(playerId, holeIdx, pIdx) {
    const key = scoreKey(playerId, holeIdx);
    const existing = scores[key] || { sips: 0, penalties: [] };
    const pens = [...existing.penalties];
    pens.splice(pIdx, 1);
    const next = { ...existing, penalties: pens };
    setScores(prev => ({ ...prev, [key]: next }));
    saveScore(playerId, holeIdx, next);
  }

  function getHoleTotal(playerId, holeIdx) {
    const s = getScore(playerId, holeIdx);
    return s.sips + s.penalties.reduce((a, b) => a + b.penalty, 0);
  }

  function getPlayerTotal(playerId) {
    return game.holes.reduce((sum, _, idx) => sum + getHoleTotal(playerId, idx), 0);
  }

  // ── Game config helpers ──
  function updateHole(idx, field, value) {
    const next = { ...game, holes: game.holes.map((h, i) => i === idx ? { ...h, [field]: value } : h) };
    setGame(next);
    saveGame(next);
  }

  function addPlayer() {
    if (!newPlayerName.trim()) return;
    const emoji = EMOJIS[game.players.length % EMOJIS.length];
    const next = { ...game, players: [...game.players, { id: Date.now(), name: newPlayerName.trim(), emoji }] };
    setGame(next);
    setNewPlayerName("");
    saveGame(next);
  }

  function removePlayer(id) {
    const next = { ...game, players: game.players.filter(p => p.id !== id) };
    setGame(next);
    saveGame(next);
  }

  function addRule() {
    if (!newRuleText.trim()) return;
    const next = { ...game, rules: [...game.rules, { id: Date.now(), text: newRuleText.trim(), penalty: newRulePenalty }] };
    setGame(next);
    setNewRuleText("");
    setNewRulePenalty(1);
    saveGame(next);
  }

  function removeRule(id) {
    const next = { ...game, rules: game.rules.filter(r => r.id !== id) };
    setGame(next);
    saveGame(next);
  }

  async function resetScores() {
    if (!window.confirm("Reset all scores? Setup stays the same.")) return;
    await supabase.from("pub_golf_scores").delete().neq("id", "___never___");
    setScores({});
  }

  const leaderboard = [...game.players]
    .map(p => ({ ...p, total: getPlayerTotal(p.id) }))
    .sort((a, b) => a.total - b.total);

  const hole = game.holes[currentHole];

  return (
    <div style={{ minHeight: "100vh", background: "#080f08", fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", color: "#ddeedd" }}>

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, #0d2b0d 0%, #061506 100%)",
        borderBottom: "1px solid #1e4d1e",
        padding: "18px 16px 0",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 30 }}>⛳</span>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a8d5a2" }}>
            PUB GOLF
          </h1>
          <span style={{ fontSize: 30 }}>🍺</span>
        </div>
        <p style={{ margin: "2px 0 10px", fontSize: 11, color: "#5a8c5a", letterSpacing: "0.12em", textTransform: "uppercase" }}>
          9 Holes · Lowest Score Wins
        </p>

        {/* Live status badge */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: status === "live" ? "#0d2b0d" : status === "error" ? "#2b0d0d" : "#1a1a0d",
            border: `1px solid ${status === "live" ? "#2d6a2d" : status === "error" ? "#6a2d2d" : "#6a6a2d"}`,
            borderRadius: 20, padding: "3px 12px", fontSize: 11,
            color: status === "live" ? "#5cb85c" : status === "error" ? "#c85c5c" : "#c8c85c",
            transition: "all 0.3s",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: status === "live" ? "#5cb85c" : status === "error" ? "#c85c5c" : "#c8c85c",
              boxShadow: liveFlash ? `0 0 8px ${status === "live" ? "#5cb85c" : "#c85c5c"}` : "none",
              transition: "box-shadow 0.3s",
            }} />
            {status === "live" ? "Live · All devices synced" : status === "error" ? "Connection error" : "Connecting…"}
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none",
              borderBottom: tab === t ? "2px solid #5cb85c" : "2px solid transparent",
              color: tab === t ? "#a8d5a2" : "#5a8c5a",
              padding: "7px 14px", fontSize: 13, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.06em",
              transition: "all 0.15s",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 580, margin: "0 auto", padding: "20px 14px" }}>

        {/* ══ SCORECARD ══ */}
        {tab === "Scorecard" && (
          <div>
            {/* Hole nav */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <button onClick={() => setCurrentHole(h => Math.max(0, h - 1))}
                disabled={currentHole === 0} style={navBtn}>◀</button>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#5a8c5a", letterSpacing: "0.12em" }}>HOLE {currentHole + 1} OF 9</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#c8e6c8" }}>{hole.bar}</div>
                {hole.drink && <div style={{ fontSize: 13, color: "#8bc88b" }}>🍺 {hole.drink}</div>}
              </div>
              <button onClick={() => setCurrentHole(h => Math.min(8, h + 1))}
                disabled={currentHole === 8} style={navBtn}>▶</button>
            </div>

            {/* Hole dots */}
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
              {game.holes.map((_, i) => (
                <button key={i} onClick={() => setCurrentHole(i)} style={{
                  width: i === currentHole ? 24 : 10, height: 10, borderRadius: 5,
                  background: i === currentHole ? "#5cb85c" : "#1e4d1e",
                  border: "none", cursor: "pointer", transition: "all 0.2s", padding: 0,
                }} />
              ))}
            </div>

            {/* Players */}
            {game.players.map(player => {
              const s = getScore(player.id, currentHole);
              const penTotal = s.penalties.reduce((a, b) => a + b.penalty, 0);
              const holeTotal = s.sips + penTotal;

              return (
                <div key={player.id} style={{
                  background: "linear-gradient(135deg, #0d2b0d, #080f08)",
                  border: "1px solid #1e4d1e",
                  borderRadius: 14, padding: 16, marginBottom: 14,
                  boxShadow: "inset 0 1px 0 #2d6a2d22",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 26 }}>{player.emoji}</span>
                      <span style={{ fontSize: 17, fontWeight: 700, color: "#c8e6c8" }}>{player.name}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#5a8c5a", letterSpacing: "0.1em" }}>HOLE</div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: "#5cb85c", lineHeight: 1 }}>{holeTotal || "–"}</div>
                    </div>
                  </div>

                  {/* Sip counter */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: "#5a8c5a", minWidth: 34, letterSpacing: "0.06em" }}>SIPS</span>
                    <button onClick={() => setSips(player.id, currentHole, s.sips - 1)} style={ctrBtn}>−</button>
                    <div style={{
                      width: 52, textAlign: "center", background: "#060d06",
                      border: "1px solid #2d6a2d", borderRadius: 8,
                      color: "#c8e6c8", fontSize: 22, fontWeight: 700, padding: "4px 0",
                    }}>{s.sips}</div>
                    <button onClick={() => setSips(player.id, currentHole, s.sips + 1)} style={ctrBtn}>+</button>
                    <div style={{ marginLeft: "auto", fontSize: 11, color: "#5a8c5a" }}>
                      Total: <span style={{ color: "#a8d5a2", fontWeight: 700 }}>{getPlayerTotal(player.id)}</span>
                    </div>
                  </div>

                  {/* Applied penalties */}
                  {s.penalties.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      {s.penalties.map((p, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          background: "#2b0d0d44", border: "1px solid #6a2d2d55",
                          borderRadius: 6, padding: "4px 10px", marginBottom: 4,
                          fontSize: 12, color: "#d4845a",
                        }}>
                          <span>⚠ +{p.penalty} — {p.text}</span>
                          <button onClick={() => removePenalty(player.id, currentHole, i)}
                            style={{ background: "none", border: "none", color: "#d4845a", cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add penalties */}
                  {game.rules.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#5a8c5a", letterSpacing: "0.08em" }}>PENALTY:</span>
                      {game.rules.map(r => (
                        <button key={r.id} onClick={() => addPenalty(player.id, currentHole, r.id)} style={{
                          background: "#2b0d0d44", border: "1px solid #c85c5c55",
                          color: "#c87070", borderRadius: 20, padding: "3px 10px",
                          fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                        }}>
                          +{r.penalty} {r.text.length > 22 ? r.text.slice(0, 22) + "…" : r.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Mini leaderboard */}
            <div style={{ background: "#0d2b0d", borderRadius: 10, padding: 14, border: "1px solid #1e4d1e", marginTop: 6 }}>
              <div style={{ fontSize: 10, color: "#5a8c5a", letterSpacing: "0.12em", marginBottom: 8 }}>RUNNING TOTALS</div>
              {leaderboard.map((p, i) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  "}</span>
                    <span style={{ color: "#c8e6c8", fontSize: 14 }}>{p.emoji} {p.name}</span>
                  </div>
                  <span style={{ color: "#5cb85c", fontWeight: 700, fontSize: 17 }}>{p.total}</span>
                </div>
              ))}
            </div>

            <button onClick={resetScores} style={{
              marginTop: 14, width: "100%", background: "transparent",
              border: "1px solid #1e4d1e55", color: "#5a8c5a44",
              borderRadius: 8, padding: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>Reset All Scores</button>
          </div>
        )}

        {/* ══ SETUP ══ */}
        {tab === "Setup" && (
          <div>
            <Section>Players</Section>
            {game.players.map(p => (
              <div key={p.id} style={rowStyle}>
                <span style={{ fontSize: 22 }}>{p.emoji}</span>
                <span style={{ flex: 1, color: "#c8e6c8" }}>{p.name}</span>
                <span style={{ fontSize: 12, color: "#5a8c5a" }}>Score: {getPlayerTotal(p.id)}</span>
                <button onClick={() => removePlayer(p.id)} style={xBtn}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <input value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPlayer()}
                placeholder="New player name…" style={inputSt} />
              <button onClick={addPlayer} style={greenBtn}>Add</button>
            </div>

            <Section>Holes / Bars</Section>
            {game.holes.map((h, idx) => (
              <div key={h.id} style={{ background: "#0d2b0d", borderRadius: 10, padding: 12, marginBottom: 10, border: "1px solid #1e4d1e44" }}>
                <div style={{ fontSize: 11, color: "#5a8c5a", letterSpacing: "0.1em", marginBottom: 6 }}>HOLE {idx + 1}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={h.bar} onChange={e => updateHole(idx, "bar", e.target.value)}
                    placeholder="Bar name" style={{ ...inputSt, flex: 1 }} />
                  <input value={h.drink} onChange={e => updateHole(idx, "drink", e.target.value)}
                    placeholder="Drink" style={{ ...inputSt, flex: 1 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ RULES ══ */}
        {tab === "Rules" && (
          <div>
            <Section>Penalty Rules</Section>
            <p style={{ fontSize: 13, color: "#5a8c5a", marginTop: 0, lineHeight: 1.6 }}>
              Breaking a rule adds penalty strokes to a player's hole score.
            </p>
            {game.rules.map(r => (
              <div key={r.id} style={{ ...rowStyle, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#c8e6c8", fontSize: 14 }}>{r.text}</div>
                  <div style={{ color: "#d4845a", fontSize: 12, marginTop: 2 }}>+{r.penalty} stroke{r.penalty !== 1 ? "s" : ""}</div>
                </div>
                <button onClick={() => removeRule(r.id)} style={xBtn}>✕</button>
              </div>
            ))}

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <input value={newRuleText} onChange={e => setNewRuleText(e.target.value)}
                placeholder="Rule description…" style={inputSt} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#5a8c5a", whiteSpace: "nowrap" }}>Penalty:</span>
                <button onClick={() => setNewRulePenalty(p => Math.max(1, p - 1))} style={ctrBtn}>−</button>
                <span style={{ color: "#d4845a", fontWeight: 700, fontSize: 18, minWidth: 20, textAlign: "center" }}>{newRulePenalty}</span>
                <button onClick={() => setNewRulePenalty(p => p + 1)} style={ctrBtn}>+</button>
                <button onClick={addRule} style={{ ...greenBtn, marginLeft: "auto" }}>Add Rule</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ LEADERBOARD ══ */}
        {tab === "Leaderboard" && (
          <div>
            <Section>Final Standings</Section>
            {leaderboard.map((p, i) => (
              <div key={p.id} style={{
                background: i === 0 ? "linear-gradient(135deg, #1a3d00, #0d2000)" : "linear-gradient(135deg, #0d2b0d, #080f08)",
                border: i === 0 ? "1px solid #5cb85c" : "1px solid #1e4d1e55",
                borderRadius: 12, padding: 16, marginBottom: 12,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <div style={{ fontSize: 30, minWidth: 36, textAlign: "center" }}>
                  {i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#c8e6c8" }}>{p.emoji} {p.name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    {game.holes.map((_, idx) => (
                      <span key={idx} style={{ fontSize: 11, color: "#5a8c5a" }}>
                        {idx + 1}: <span style={{ color: "#8bc88b" }}>{getHoleTotal(p.id, idx) || "–"}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#5a8c5a" }}>TOTAL</div>
                  <div style={{ fontSize: 34, fontWeight: 900, color: i === 0 ? "#5cb85c" : "#a8d5a2", lineHeight: 1 }}>{p.total}</div>
                </div>
              </div>
            ))}

            {/* Full score table */}
            <div style={{ overflowX: "auto", marginTop: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thSt}>Player</th>
                    {game.holes.map((h, i) => (
                      <th key={i} style={thSt} title={h.bar}>{i + 1}</th>
                    ))}
                    <th style={{ ...thSt, color: "#5cb85c" }}>⛳</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(p => (
                    <tr key={p.id}>
                      <td style={tdSt}>{p.emoji} {p.name}</td>
                      {game.holes.map((_, idx) => {
                        const t = getHoleTotal(p.id, idx);
                        return <td key={idx} style={{ ...tdSt, color: t > 0 ? "#a8d5a2" : "#2d6a2d" }}>{t || "–"}</td>;
                      })}
                      <td style={{ ...tdSt, color: "#5cb85c", fontWeight: 700 }}>{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ children }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: "0.15em", color: "#5cb85c",
      textTransform: "uppercase", borderBottom: "1px solid #1e4d1e44",
      paddingBottom: 6, marginBottom: 12, marginTop: 4,
    }}>{children}</div>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const navBtn = {
  background: "#0d2b0d", border: "1px solid #2d6a2d", color: "#8bc88b",
  borderRadius: 8, width: 36, height: 36, fontSize: 14, cursor: "pointer",
};
const ctrBtn = {
  background: "#0d2b0d", border: "1px solid #2d6a2d", color: "#c8e6c8",
  borderRadius: 6, width: 34, height: 34, fontSize: 20, cursor: "pointer",
  fontFamily: "inherit", lineHeight: 1,
};
const rowStyle = {
  display: "flex", alignItems: "center", gap: 10,
  background: "#0d2b0d", borderRadius: 8, padding: "10px 12px",
  marginBottom: 8, border: "1px solid #1e4d1e33",
};
const xBtn = {
  background: "none", border: "none", color: "#c85c5c66",
  cursor: "pointer", fontSize: 16, padding: 0,
};
const inputSt = {
  background: "#060d06", border: "1px solid #2d6a2d", borderRadius: 8,
  color: "#ddeedd", padding: "8px 12px", fontSize: 14, fontFamily: "inherit",
  outline: "none", width: "100%", boxSizing: "border-box",
};
const greenBtn = {
  background: "#1e4d1e", border: "none", color: "#a8d5a2",
  borderRadius: 8, padding: "8px 16px", fontSize: 14,
  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
};
const thSt = {
  padding: "7px 5px", textAlign: "center", color: "#5a8c5a",
  borderBottom: "1px solid #1e4d1e44", fontWeight: 600,
};
const tdSt = {
  padding: "6px 5px", textAlign: "center", color: "#8bc88b",
  borderBottom: "1px solid #1e4d1e22", whiteSpace: "nowrap",
};

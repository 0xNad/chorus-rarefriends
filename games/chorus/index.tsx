"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { createFriendReader, spriteFrame, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import type { GameSnapshot } from "@rarefriends/friendsdk/game";
import { composeSong, PHRASE_COUNT, type Phrase, type Song } from "./composition.js";
import { createChorusSynth, type ChorusSynth } from "./synth.js";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;
const PIXEL = 16;
const ECHO_WINDOW_MS = 160;
const MASTERY = 0.6;
const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;

type Menu = "buy" | "inventory" | "settings" | "about" | null;
type Stage =
  | { kind: "idle" }
  | { kind: "revealing"; outcomeId: number }
  | { kind: "echo"; outcomeId: number; expected: readonly number[]; startedAt: number }
  | { kind: "song" };

export default function Chorus({ friendId, client, paused }: GameComponentProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [sprites, setSprites] = useState<GenerationSprites | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [artError, setArtError] = useState("");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [resonance, setResonance] = useState(0);
  const [mastered, setMastered] = useState<readonly number[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  const [beamNote, setBeamNote] = useState(-1);
  const [hitNotes, setHitNotes] = useState<readonly number[]>([]);
  const [artAttempt, setArtAttempt] = useState(0);

  const synth = useRef<ChorusSynth | null>(null);
  const cues = useRef<FriendSoundKit | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pulse = useRef(0);
  const locked = useRef(false);
  const epoch = useRef(0);
  const stageRef = useRef<Stage>(stage);
  const usedRef = useRef<Set<number>>(new Set());

  stageRef.current = stage;
  const definition = client.definition;
  const song: Song | null = useMemo(
    () => (sprites ? composeSong(sprites.familyId, sprites.seed) : null),
    [sprites],
  );

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);
  const later = useCallback((work: () => void, delay: number) => {
    timers.current.push(setTimeout(work, Math.max(0, delay)));
  }, []);

  /** Session state belongs to one Friend and one client; a change restarts everything. */
  useEffect(() => {
    const version = ++epoch.current;
    synth.current = createChorusSynth();
    cues.current = createFriendSoundKit({ muted: false });
    setSnapshot(null); setSprites(null); setMenu(null); setStage({ kind: "idle" });
    setError(""); setArtError(""); setMessage(""); setBusy(false);
    setMuted(false); setResonance(0); setMastered([]); setLit(null);
    locked.current = false;

    // The runtime leaves its loading state only once the child reads its snapshot.
    void client.read()
      .then(value => { if (version === epoch.current) setSnapshot(value); })
      .catch(cause => {
        if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load this session.");
      });

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => {
      epoch.current++;
      clearTimers();
      synth.current?.dispose(); synth.current = null;
      cues.current?.dispose(); cues.current = null;
      preference.removeEventListener("change", update);
    };
  }, [client, friendId, clearTimers]);

  /** Canonical artwork is a public, wallet-free read; ownership is verified by the runtime. */
  useEffect(() => {
    const version = epoch.current;
    let active = true;
    setArtError("");
    createFriendReader().read(friendId)
      .then(value => { if (active && version === epoch.current) setSprites(value); })
      .catch(() => {
        if (active && version === epoch.current) setArtError("Could not read this Friend's artwork from Robinhood mainnet.");
      });
    return () => { active = false; };
  }, [friendId, artAttempt]);

  /** Stop sound and any performance the moment the runtime takes over the frame. */
  useEffect(() => {
    if (!paused) return;
    clearTimers();
    synth.current?.stop();
    cues.current?.stop();
    setStage(current => (current.kind === "idle" ? current : { kind: "idle" }));
  }, [paused, clearTimers]);

  /** Match the canvas backing store to its box so pixels stay square and crisp. */
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const fit = () => {
      const box = node.getBoundingClientRect();
      const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const size = Math.max(96, Math.round(Math.min(box.width, box.height) * ratio));
      if (Math.abs(node.width - size) > 1) { node.width = size; node.height = size; }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [sprites]);

  /** Draw the Friend's canonical pixels at an integer scale, never resampled. */
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context || !sprites) return;
    let frame = 0;
    const render = () => {
      const scale = Math.max(1, Math.floor(node.width / (PIXEL + 2)));
      const size = PIXEL * scale;
      const left = Math.floor((node.width - size) / 2);
      const top = Math.floor((node.height - size) / 2);
      const step = reducedMotion ? 0 : Math.floor(performance.now() / 120) % 8;
      const rows = spriteFrame(sprites, "down", false, step).frame.rows;
      context.clearRect(0, 0, node.width, node.height);
      context.imageSmoothingEnabled = false;

      const glow = reducedMotion ? Math.min(pulse.current, 0.45) : pulse.current;
      if (glow > 0.01) {
        const radius = size * (0.55 + glow * 0.35);
        const halo = context.createRadialGradient(node.width / 2, node.height / 2, size * 0.1, node.width / 2, node.height / 2, radius);
        halo.addColorStop(0, `rgba(204, 255, 0, ${0.34 * glow})`);
        halo.addColorStop(1, "rgba(204, 255, 0, 0)");
        context.fillStyle = halo;
        context.fillRect(0, 0, node.width, node.height);
      }
      context.fillStyle = "#ffffff";
      for (let y = 0; y < PIXEL; y++) {
        for (let x = 0; x < PIXEL; x++) {
          if (rows[y][x] === "#") context.fillRect(left + x * scale, top + y * scale, scale, scale);
        }
      }
      pulse.current = Math.max(0, pulse.current - 0.045);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [sprites, reducedMotion]);

  const held = useMemo(
    () => (snapshot ? snapshot.inventory.map(amount => Number(amount)) : new Array<number>(PHRASE_COUNT).fill(0)),
    [snapshot],
  );
  const heldCount = held.filter(amount => amount > 0).length;
  const complete = heldCount === PHRASE_COUNT;

  async function act(work: () => Promise<void>) {
    if (locked.current || paused) return;
    const version = epoch.current;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await work();
      const value = await client.read();
      if (version === epoch.current) setSnapshot(value);
    } catch (cause) {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "That action did not complete.");
    } finally {
      if (version === epoch.current) { locked.current = false; setBusy(false); }
    }
  }

  async function enableAudio() {
    if (muted) return false;
    const ready = await synth.current?.unlock();
    void cues.current?.unlock();
    return Boolean(ready);
  }

  /** Light the Friend on each note, whether or not the player can hear it. */
  function schedulePulses(onsets: readonly number[], phraseIndex: number) {
    onsets.forEach((onset, note) => {
      later(() => { pulse.current = 1; setLit(phraseIndex); setBeamNote(note); }, onset);
    });
  }

  const capture = () => act(async () => {
    const version = epoch.current;
    if (!song) throw new Error("This Friend's song is still loading.");
    await enableAudio();
    const pending = snapshot?.plays.find(play => play.outcomeId === null);
    const play = pending ?? (await client.play(1n))[0];
    const settled = await client.settle(play.id);
    const outcomeId = settled.outcomeId;
    if (version !== epoch.current || outcomeId === null) return;

    const phrase = song.phrases[outcomeId - 1];
    const copies = Number(snapshot?.inventory[outcomeId - 1] ?? 0n) + 1;
    setStage({ kind: "revealing", outcomeId });
    setHitNotes([]); setBeamNote(-1);
    cues.current?.play(outcomeId >= 7 ? "reveal-legendary" : outcomeId >= 5 ? "reveal-rare" : "reveal-common");
    const scheduled = synth.current?.playPhrase(phrase, song.voice, song.secondsPerBeat, copies, 260);
    if (scheduled) {
      schedulePulses(scheduled.onsets, outcomeId - 1);
      // The echo is optional practice, never a condition of the reward.
      later(() => {
        if (version !== epoch.current || stageRef.current.kind !== "revealing") return;
        usedRef.current = new Set();
        const base = phrase.notes.reduce<number[]>((offsets, note, index) => {
          const previous = offsets[index - 1] ?? 0;
          const gap = index === 0 ? 0 : phrase.notes[index - 1].beats * song.secondsPerBeat * 1000;
          offsets.push(previous + gap);
          return offsets;
        }, []);
        setStage({ kind: "echo", outcomeId, expected: base, startedAt: performance.now() });
        later(() => {
          if (version === epoch.current && stageRef.current.kind === "echo") finishEcho(outcomeId, base.length);
        }, base[base.length - 1] + 1400);
      }, scheduled.duration + 340);
    }
  });

  function finishEcho(outcomeId: number, total: number) {
    const hits = usedRef.current.size;
    const accuracy = total === 0 ? 0 : hits / total;
    if (accuracy >= MASTERY) {
      setMastered(current => (current.includes(outcomeId - 1) ? current : [...current, outcomeId - 1]));
      setResonance(current => current + Math.round(accuracy * 100));
      setMessage(`Echo matched ${hits}/${total}. ${definition.outcomes[outcomeId - 1].name} mastered.`);
      cues.current?.play("reward");
    } else if (hits > 0) {
      setResonance(current => current + Math.round(accuracy * 60));
      setMessage(`Echo matched ${hits}/${total}. The phrase is still yours.`);
    } else {
      setMessage(`${definition.outcomes[outcomeId - 1].name} captured.`);
    }
    setStage({ kind: "idle" });
    setLit(null); setBeamNote(-1);
  }

  function tap() {
    const current = stageRef.current;
    if (current.kind !== "echo" || paused) return;
    void enableAudio();
    const at = performance.now() - current.startedAt;
    let best = -1;
    let bestGap = ECHO_WINDOW_MS;
    current.expected.forEach((onset, index) => {
      const gap = Math.abs(onset - at);
      if (!usedRef.current.has(index) && gap <= bestGap) { best = index; bestGap = gap; }
    });
    if (best >= 0) { usedRef.current.add(best); setHitNotes(list => [...list, best]); setBeamNote(best); }
    pulse.current = 1;
    if (usedRef.current.size === current.expected.length) {
      later(() => { if (stageRef.current.kind === "echo") finishEcho(current.outcomeId, current.expected.length); }, 240);
    }
  }

  const playSong = () => act(async () => {
    if (!song) return;
    const version = epoch.current;
    await enableAudio();
    const chosen = song.phrases.filter(phrase => held[phrase.index] > 0);
    if (!chosen.length) { setMessage("No phrases held yet. Capture one to begin the song."); return; }
    setStage({ kind: "song" });
    const sequence = synth.current?.playSequence(chosen, song.voice, song.secondsPerBeat, phrase => Math.min(3, held[phrase.index]));
    if (!sequence) return;
    chosen.forEach((phrase, index) => {
      let cursor = sequence.starts[index];
      phrase.notes.forEach((note, step) => {
        later(() => { pulse.current = 1; setLit(phrase.index); setBeamNote(step); }, cursor);
        cursor += note.beats * song.secondsPerBeat * 1000;
      });
    });
    later(() => {
      if (version === epoch.current) { setStage({ kind: "idle" }); setLit(null); setBeamNote(-1); }
    }, sequence.duration + 200);
  });

  function stopEverything() {
    clearTimers();
    synth.current?.stop();
    cues.current?.stop();
    setStage({ kind: "idle" });
    setLit(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.code !== "Enter") return;
      if (stageRef.current.kind !== "echo") return;
      event.preventDefault();
      tap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!snapshot) {
    return <div className="chorus-boot" role={error ? "alert" : "status"}>
      {error || "Loading Chorus…"}
      {error && <button type="button" onClick={() => void act(async () => {})}>Retry</button>}
    </div>;
  }
  if (snapshot.friendId !== friendId) return <p role="alert">This session does not match the selected Friend.</p>;

  const maxPrize = definition.outcomes.reduce((max, item) => (item.reward > max ? item.reward : max), 0n);
  const canBuy = snapshot.rfBalance >= definition.price && snapshot.freeStake >= maxPrize;
  const pendingPlay = snapshot.plays.some(play => play.outcomeId === null);
  const canCapture = Boolean(song) && (pendingPlay || snapshot.consumables > 0n);
  const performing = stage.kind === "echo";
  // The phrase currently sounding or being echoed, drawn as pitch-height bars.
  const ribbon = song && lit !== null && stage.kind !== "idle" ? song.phrases[lit] : null;
  const spent = snapshot.stake - maxPrize * 10n;

  return <section className="chorus" aria-label="Chorus" aria-busy={busy} data-stage={stage.kind}>
    <header className="chorus-hud">
      <div className="chorus-identity">
        <strong>Chorus</strong>
        <span>Friend #{friendId.toString()}{song ? ` · ${song.voice.label} · key ${song.keyName} · ${song.bpm} BPM` : ""}</span>
      </div>
      <div className="chorus-meters">
        <span title="Simulated RF balance">{rf(snapshot.rfBalance)}</span>
        <span>{snapshot.consumables.toString()} Tones</span>
        <span>{heldCount}/{PHRASE_COUNT} phrases</span>
        <span className="chorus-resonance">Resonance {resonance}</span>
      </div>
    </header>

    <div className="chorus-stage">
      <p className="chorus-sim" aria-live="off">Simulated economy · no real RF moves</p>
      {artError
        ? <div className="chorus-art-error" role="alert">
            <p>{artError}</p>
            <button type="button" onClick={() => setArtAttempt(value => value + 1)}>Retry artwork</button>
          </div>
        : <canvas ref={canvas} width={360} height={360} className="chorus-canvas"
            aria-label={`Friend #${friendId.toString()} canonical artwork`} role="img" />}
      {!sprites && !artError && <p className="chorus-waiting" role="status">Reading this Friend's artwork…</p>}

      {/* Always present so the stage does not jump when a phrase starts. */}
      <div className="chorus-ribbon" aria-hidden="true">
        {ribbon?.notes.map((note, index) => <span key={index}
          className={`chorus-bar${index === beamNote ? " now" : ""}${hitNotes.includes(index) ? " hit" : ""}`}
          style={{ height: `${14 + ((note.midi - 40) / 52) * 86}%`, flexGrow: note.beats }} />)}
      </div>

      {performing && <div className="chorus-echo">
        <p>Echo the phrase — tap the pad or press Space on each note.</p>
        <p className="chorus-tally">matched {hitNotes.length} / {stage.expected.length}</p>
        <button type="button" className="chorus-pad" onPointerDown={tap}>Tap</button>
        <button type="button" className="chorus-skip"
          onClick={() => finishEcho(stage.outcomeId, stage.expected.length)}>Skip the echo</button>
      </div>}
    </div>

    <ol className="chorus-rail" aria-label="Phrases held">
      {definition.outcomes.map((outcome, index) => {
        const count = held[index];
        return <li key={outcome.name}
          className={`chorus-slot${count > 0 ? " held" : ""}${lit === index ? " lit" : ""}${mastered.includes(index) ? " mastered" : ""}`}>
          <span className="chorus-numeral" aria-hidden="true">{ROMAN[index]}</span>
          <span className="chorus-name">{outcome.name}</span>
          <span className="chorus-count">{count > 0 ? (count > 1 ? `×${count}` : "held") : "—"}</span>
        </li>;
      })}
    </ol>

    <div className="chorus-actions">
      <button type="button" className="rf-frame-primary" disabled={!canBuy || busy || paused || performing}
        onClick={() => void act(async () => {
          await client.buy(1n);
          void cues.current?.unlock();
          cues.current?.play("purchase");
          setMessage("One simulated Tone added.");
        })}>Buy Tone · {rf(definition.price)}</button>
      <button type="button" disabled={!canCapture || busy || paused || performing} onClick={() => void capture()}>
        {pendingPlay ? "Finish capture" : "Capture a phrase"}
      </button>
      <button type="button" disabled={busy || paused || performing || heldCount === 0 || stage.kind === "song"}
        onClick={() => void playSong()}>{complete ? "Play the whole song" : `Play song · ${heldCount}`}</button>
      {stage.kind === "song" && <button type="button" onClick={stopEverything}>Stop</button>}
      <button type="button" onClick={() => setMenu("inventory")} disabled={busy || performing}>Phrases</button>
      <button type="button" onClick={() => setMenu("settings")} disabled={performing}>Settings</button>
    </div>

    <p className="chorus-feedback" role={error ? "alert" : "status"}>
      {error || message || (busy ? "Waiting for the runtime…" : complete
        ? "Every phrase is held. Play the whole song."
        : "Buy a Tone, capture a phrase, echo it back.")}
    </p>

    {menu && <GameMenu
      title={menu === "inventory" ? "Phrases held" : menu === "settings" ? "Settings" : menu === "buy" ? "Tones" : "About Chorus"}
      onClose={busy ? undefined : () => { setMenu(null); setError(""); }}>
      {menu === "inventory" ? <>
        <p>A phrase you hold is audible in your song. Redeeming it returns {"its"} simulated RF and removes it from the arrangement.</p>
        {definition.outcomes.map((outcome, index) => <div className="chorus-row" key={outcome.name}>
          <span>
            <strong>{ROMAN[index]} · {outcome.name}</strong>
            <small>{held[index]} held · {rf(outcome.reward)} · {outcome.chanceBps / 100}%</small>
          </span>
          <button type="button" disabled={busy || paused || held[index] === 0}
            onClick={() => void act(async () => {
              await client.redeem(index + 1, 1n);
              setMessage(`Redeemed ${outcome.name} for ${rf(outcome.reward)}.`);
            })}>Redeem one</button>
        </div>)}
        <p className="chorus-note">Duplicates thicken a phrase up to three layers. Redeeming spare copies keeps the phrase audible while returning RF.</p>
      </> : menu === "settings" ? <>
        <button type="button" aria-pressed={!muted} onClick={() => {
          const next = !muted;
          setMuted(next);
          synth.current?.setMuted(next);
          cues.current?.setMuted(next);
          if (!next) { void synth.current?.unlock(); void cues.current?.unlock(); }
        }}>{muted ? "Sound off" : "Sound on"}</button>
        <label><input type="checkbox" checked={reducedMotion}
          onChange={event => setReducedMotion(event.target.checked)} /> Reduce motion</label>
        <p>Chorus is fully playable with sound off: every note is also a pulse on your Friend and a marker on the phrase rail.</p>
        <p className="chorus-note">
          Simulated RF, Tones and phrases last for this runtime session only; reloading starts a new one.
          The SDK supplies wallet connection and fresh ownership verification.
          Simulated RF committed this session: {rf(spent > 0n ? spent : 0n)}.
        </p>
      </> : <>
        <p>Every Friend's song comes from its own on-chain data: {"familyOf(tokenId)"} chooses the voice and scale, {"seedOf(tokenId)"} sets the key, tempo and melody.</p>
        <p>Nothing is saved, and nothing needs to be — the same Friend composes the same song on any device.</p>
      </>}
    </GameMenu>}
  </section>;
}

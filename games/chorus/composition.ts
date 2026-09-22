/**
 * Deterministic composition for Chorus.
 *
 * Every note is derived only from the Friend's on-chain `familyOf(tokenId)` and
 * `seedOf(tokenId)`. Both are pure contract functions, so a given Friend always
 * produces the same song on any device, in any session, with no saved state.
 * Nothing here touches RF, odds, rewards or the published outcome table.
 */

export const PHRASE_COUNT = 8;

/** Keep every generated note inside a comfortably audible band (E2 to G#6). */
const SAFE_LOW_MIDI = 40;
const SAFE_HIGH_MIDI = 92;

/** Scale-degree offsets in semitones. */
const SCALES = {
  hirajoshi: [0, 2, 3, 7, 8],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
} as const;

export type Voice = Readonly<{
  /** Instrument name shown to the player. */
  label: string;
  wave: OscillatorType;
  scale: readonly number[];
  /** Root octave offset in semitones from MIDI 60. */
  octave: number;
  bpm: number;
  /** Width of the second, detuned oscillator in cents. */
  detune: number;
  /** Note release in seconds. */
  release: number;
  /** Low-pass cutoff in Hz. */
  cutoff: number;
}>;

/**
 * One voice per canonical Generations family, in the SDK's family order:
 * Skeleton, Mask, Family, Cellular, Asymmetry, Hoverer, Colossus, Sparkling, Hollow.
 */
export const FAMILY_VOICES: readonly Voice[] = Object.freeze([
  { label: "Bone flute", wave: "triangle", scale: SCALES.hirajoshi, octave: -12, bpm: 84, detune: 0, release: 0.50, cutoff: 2600 },
  { label: "Masked reed", wave: "square", scale: SCALES.dorian, octave: 0, bpm: 104, detune: 4, release: 0.28, cutoff: 1900 },
  { label: "Hearth chime", wave: "triangle", scale: SCALES.majorPentatonic, octave: 0, bpm: 96, detune: 6, release: 0.60, cutoff: 3200 },
  { label: "Cell pulse", wave: "square", scale: SCALES.lydian, octave: 12, bpm: 120, detune: 2, release: 0.20, cutoff: 2400 },
  { label: "Skew string", wave: "sawtooth", scale: SCALES.phrygian, octave: 0, bpm: 92, detune: 9, release: 0.34, cutoff: 1500 },
  { label: "Hover glass", wave: "sine", scale: SCALES.wholeTone, octave: 12, bpm: 76, detune: 3, release: 0.75, cutoff: 3600 },
  { label: "Colossus horn", wave: "square", scale: SCALES.aeolian, octave: -24, bpm: 64, detune: 5, release: 0.70, cutoff: 1100 },
  { label: "Spark bell", wave: "triangle", scale: SCALES.major, octave: 12, bpm: 132, detune: 1, release: 0.42, cutoff: 4200 },
  { label: "Hollow drone", wave: "sine", scale: SCALES.minorPentatonic, octave: 0, bpm: 70, detune: 11, release: 0.85, cutoff: 2000 },
].map(voice => Object.freeze({ ...voice, scale: Object.freeze([...voice.scale]) })) as Voice[]);

export type Note = Readonly<{ degree: number; beats: number; midi: number; frequency: number }>;
export type Phrase = Readonly<{ index: number; role: string; notes: readonly Note[]; beats: number }>;
export type Song = Readonly<{
  familyId: number; seed: number; voice: Voice; rootMidi: number; keyName: string;
  bpm: number; secondsPerBeat: number; phrases: readonly Phrase[];
}>;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Small, fast, fully deterministic PRNG. Identical output for an identical seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6d2b79f5 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Resolve a scale degree, which may be negative or beyond one octave, to a MIDI note. */
export function degreeToMidi(rootMidi: number, scale: readonly number[], degree: number) {
  const size = scale.length;
  const octave = Math.floor(degree / size);
  const step = ((degree % size) + size) % size;
  return rootMidi + octave * 12 + scale[step];
}

export const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

type RoleShape = Readonly<{ role: string; length: number; octave: number; rhythm: readonly number[]; settle: boolean }>;

/** Phrase shapes, in the same order as the published outcome table in game.json. */
const ROLES: readonly RoleShape[] = Object.freeze([
  { role: "Verse I", length: 4, octave: 0, rhythm: [1, 1, 1, 1], settle: false },
  { role: "Verse II", length: 4, octave: 0, rhythm: [1, 0.5, 0.5, 1], settle: false },
  { role: "Verse III", length: 5, octave: 0, rhythm: [0.5, 0.5, 1, 0.5, 1], settle: false },
  { role: "Verse IV", length: 5, octave: 0, rhythm: [1, 0.5, 0.5, 0.5, 1], settle: false },
  { role: "Bridge", length: 6, octave: 1, rhythm: [0.5, 0.5, 0.5, 0.5, 1, 1], settle: false },
  { role: "Counter", length: 5, octave: -1, rhythm: [0.75, 0.25, 0.75, 0.25, 1], settle: false },
  { role: "Descant", length: 6, octave: 2, rhythm: [0.5, 0.5, 0.5, 0.5, 0.5, 1.5], settle: false },
  { role: "Refrain", length: 7, octave: 0, rhythm: [1, 0.5, 0.5, 1, 0.5, 0.5, 2], settle: true },
]);

/**
 * Build the Friend's song. A single three-step motif drawn from the seed is
 * rotated and inverted across the phrases, so they sound like one piece of music
 * rather than eight unrelated runs of notes.
 */
export function composeSong(familyId: number, seed: number): Song {
  if (!Number.isInteger(familyId) || familyId < 0 || familyId >= FAMILY_VOICES.length) {
    throw new RangeError("Unknown Friend family.");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must fit uint32.");

  const voice = FAMILY_VOICES[familyId];
  const random = mulberry32((seed ^ Math.imul(familyId + 1, 0x9e3779b1)) >>> 0);
  const pick = (count: number) => Math.floor(random() * count);

  const rootPitchClass = pick(12);
  const rootMidi = 60 + voice.octave + rootPitchClass;
  const bpm = voice.bpm + pick(17) - 8;
  const secondsPerBeat = 60 / bpm;

  // The shared motif: three scale-degree steps in [-2, 3]. Some seeds otherwise
  // draw a near-static motif (say [0, 0, 1]), which gives that Friend a
  // monotone song made mostly of repeated notes. Redraw deterministically until
  // the motif actually moves: at least two non-zero steps and at least two
  // distinct values, so every Friend gets a melody with real contour.
  const drawMotif = () => [pick(6) - 2, pick(6) - 2, pick(6) - 2];
  const singable = (steps: readonly number[]) =>
    steps.filter(step => step !== 0).length >= 2 && new Set(steps).size >= 2
    && steps.reduce((total, step) => total + Math.abs(step), 0) >= 3;
  let motif = drawMotif();
  for (let attempt = 0; attempt < 24 && !singable(motif); attempt++) motif = drawMotif();
  const openings = Array.from({ length: PHRASE_COUNT }, () => pick(5) - 2);

  const phrases = ROLES.map((shape, index) => {
    // Each phrase rotates the motif and every other phrase inverts it, so the
    // material recurs in a recognisable but varied way.
    const rotation = index % motif.length;
    const inverted = index % 2 === 1;
    let degree = openings[index] + shape.octave * voice.scale.length;

    const draft: { degree: number; beats: number; midi: number }[] = [];
    for (let step = 0; step < shape.length; step++) {
      if (step > 0) {
        const move = motif[(step - 1 + rotation) % motif.length];
        degree += inverted ? -move : move;
        // Keep phrases singable rather than letting them drift away.
        if (degree > shape.octave * voice.scale.length + 7) degree -= voice.scale.length;
        if (degree < shape.octave * voice.scale.length - 5) degree += voice.scale.length;
      }
      // The refrain resolves onto the tonic so the song has an ending.
      const finalNote = shape.settle && step === shape.length - 1;
      const resolved = finalNote ? shape.octave * voice.scale.length : degree;
      draft.push({ degree: resolved, beats: shape.rhythm[step] ?? 1, midi: degreeToMidi(rootMidi, voice.scale, resolved) });
    }

    // Deep families and high roles can otherwise stack into inaudible sub-bass or
    // piercing highs. Shift the whole phrase by octaves so its shape is preserved.
    let shift = 0;
    const lowest = Math.min(...draft.map(note => note.midi));
    const highest = Math.max(...draft.map(note => note.midi));
    while (lowest + shift < SAFE_LOW_MIDI) shift += 12;
    while (highest + shift > SAFE_HIGH_MIDI) shift -= 12;

    const notes = draft.map(note => {
      // A phrase wider than the safe band is clamped note by note as a last resort.
      const midi = Math.min(SAFE_HIGH_MIDI, Math.max(SAFE_LOW_MIDI, note.midi + shift));
      return Object.freeze({ degree: note.degree, beats: note.beats, midi, frequency: midiToFrequency(midi) });
    });

    return Object.freeze({
      index, role: shape.role, notes: Object.freeze(notes),
      beats: notes.reduce((total, note) => total + note.beats, 0),
    });
  });

  return Object.freeze({
    familyId, seed, voice, rootMidi, keyName: `${NOTE_NAMES[rootPitchClass]}`,
    bpm, secondsPerBeat, phrases: Object.freeze(phrases),
  });
}

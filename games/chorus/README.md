# Chorus

**Every Rare Friend has a song. Spend $RAREFRIENDS to learn it, phrase by phrase,
until you can play the whole thing.**

Chorus reads the selected Generations NFT's own on-chain data and composes a
piece of music from it. `familyOf(tokenId)` chooses the instrument and scale;
`seedOf(tokenId)` sets the key, tempo and melody. Both are pure contract
functions, so a given Friend always produces the same song — on any device, in
any session, with nothing saved anywhere.

Built with **FriendSDK v0.1.2**. Purchases, balances and rewards are **simulated**.

## Run it

From the SDK checkout:

```sh
npm ci
npm run build
npm run dev:game -- games/chorus
```

Open the printed URL (normally `http://localhost:4173`). To play from a phone on
the same network:

```sh
npm run dev:game -- games/chorus --host 0.0.0.0 --port 4173
```

Requires a browser wallet on **Robinhood mainnet (chain 4663)** holding a
hardwired Generations NFT of **generation 1 or higher**. The SDK runtime supplies
wallet connection, Friend selection and a fresh ownership check; Chorus does not
implement any of those.

## How to play

1. **Buy a Tone** — 1 simulated RF. Confirmed in the SDK's trusted frame.
2. **Capture a phrase** — spends the Tone. One phrase of your Friend's song is
   drawn from the published table below, then plays.
3. **Echo it** — tap the pad or press **Space** once per note. The echo is
   optional practice that feeds a non-financial Resonance score. It never
   affects which phrase you got, its RF value, or anything else in the economy.
   **Skip the echo** resolves it immediately.
4. **Play song** — plays every phrase you currently hold, in order. Hold all
   eight and you hear the complete piece.

A phrase you hold is audible in your song. **Redeeming it returns its simulated
RF and removes it from the arrangement.** That is the whole tension: the song is
worth more assembled than cashed out.

Duplicates are not waste — a second and third copy of a phrase thicken it with
extra octave layers, up to three. You can redeem the spares for RF and keep the
phrase audible.

### Controls

| Input | Action |
| --- | --- |
| Tap / click the pad | Echo a note |
| **Space** or **Enter** | Echo a note |
| Buttons | Buy, capture, play, redeem, settings |

Touch and keyboard are both supported. There is no character movement; this is
not a walkable world.

## Economy

Simulated. One consumable, one published outcome table, exactly as the SDK's
chance-game client defines it.

- **Consumable:** Tone — **1.00 RF**
- **Expected reward:** **0.90 RF** per Tone
- **Maximum prize:** 7.00 RF (each purchase reserves this much backing)

| # | Phrase | Chance | Redeem value |
| --- | --- | --- | --- |
| I | Verse I | 19.00% | 0.55 RF |
| II | Verse II | 18.00% | 0.55 RF |
| III | Verse III | 17.00% | 0.60 RF |
| IV | Verse IV | 15.00% | 0.65 RF |
| V | Bridge | 13.00% | 0.90 RF |
| VI | Counter | 10.00% | 1.20 RF |
| VII | Descant | 6.00% | 2.00 RF |
| VIII | Refrain | 2.00% | 7.00 RF |

Chances total 10000 basis points. Every purchased Tone reserves its maximum
prize; kept phrases retain their RF backing with no redemption expiry. RF amounts
are bigint base units (1 RF = 10^18).

The outcome table, its odds and its values are **global and fixed**. The Friend's
family and seed change only what the music sounds like — never the odds, never a
reward, never the published terms.

## What comes from the chain

| On-chain value | What it determines |
| --- | --- |
| `familyOf(tokenId)` | Instrument voice, waveform and musical scale (9 families, 9 voices) |
| `seedOf(tokenId)` | Key, tempo and every note of all eight phrases |
| `frames(family, seed)` | The canonical 16×16 sprite, drawn unmodified at an integer scale |

Artwork and registry reads are public and need no wallet. Ownership is verified
separately by the SDK runtime.

Across 27,000 generated family/seed combinations the composer produced 27,000
distinct songs, and every note falls between E2 (82 Hz) and G#6 (1661 Hz).

## Accessibility

- **Fully playable with sound off.** Every note is also a bar on the note ribbon
  and a pulse on the Friend. The echo scores identically when muted, because its
  timing comes from the composition rather than from the audio clock.
- **Mute** control in Settings; audio is off until you turn it on.
- **Reduced motion** honoured from `prefers-reduced-motion` and toggleable in
  Settings. It stills the idle animation and damps the glow.
- Keyboard operable throughout; visible focus rings.
- Loading, error and retry states for both the session and the artwork read.
- Portrait frame on narrow screens via `host.css`, so phones get a usable layout
  instead of a 240 px-tall strip.

## Checks

```sh
npx friendsdk check games/chorus
node games/chorus/test.mjs 960 ./artifacts/chorus-960.png
node games/chorus/test.mjs 360 ./artifacts/chorus-360.png
```

`test.mjs` drives the real runtime in headless Chromium with the SDK's read-only
wallet/RPC fixtures. It asserts that the artwork resolves, the composed voice
matches the fixture Friend, buy → capture → hold works, the capture and play
controls stay locked while a phrase is playing (with a spare Tone in hand), the
echo masters the phrase when played on the composed 77 BPM cadence, Resonance
rises without touching the ledger, redeeming releases the phrase, and the mute
and reduced-motion controls work. Requires `playwright` and Chromium.

The fixture pins the preview roll to outcome 1, so the full-resonance state and
the rarer phrases are checked by hand rather than by the harness.

## Known limitations

- **No persistence.** The SDK sandbox has no storage and the bridge has no save
  API, so held phrases and Resonance last for one runtime session. The *song
  itself* is not affected — it is recomputed from chain data every time, so your
  Friend always sounds the same.
- The RF outcome is a weighted draw. Echo accuracy is presentation and a
  non-financial score only; it cannot change a reward. Preview randomness is
  browser entropy, which is preview-only by design.
- Audio needs a user gesture to start, per browser autoplay rules. If a browser
  refuses an AudioContext, the game keeps working silently and the ribbon still
  shows every note.
- Live on-chain play is not implemented. This is a simulated prototype.

## Credits

Character artwork is the canonical Rare Friends Generations sprite set, read from
the pinned artwork deployment and drawn unmodified. Music, code, interface and
the note ribbon are original work for this submission. No third-party audio
samples: every sound is synthesised by oscillators at runtime.

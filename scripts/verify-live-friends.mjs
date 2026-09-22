/**
 * Read real Friends from Robinhood mainnet and compose their real songs.
 *
 * Artwork and trait reads on the Generations registry are public view/pure
 * functions, so this needs no wallet, no key and no signature. It verifies the
 * claim the submission actually rests on: that distinct real token IDs produce
 * distinct real music, not just that synthetic seeds do.
 *
 * Usage: node scripts/verify-live-friends.mjs [tokenId ...]
 */
import { createPublicClient, http } from "viem";
import {
  FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST, GENERATION_FAMILY_NAMES,
  decodeGenerationSprites, spriteFrame,
} from "@rarefriends/friendsdk/sprites";
import { GENERATION_ELIGIBILITY_ABI } from "@rarefriends/friendsdk/identity";
import { composeSong } from "../games/chorus/composition.ts";

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const name = midi => `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

// Token IDs seen publicly in other vibeathon submissions, plus the SDK fixture.
const DEFAULT_IDS = [7730n, 87846n, 20838n, 597n, 1n, 4242n, 31337n, 65001n];
const ids = process.argv.slice(2).length
  ? process.argv.slice(2).map(value => BigInt(value))
  : DEFAULT_IDS;

const client = createPublicClient({
  transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { retryCount: 2, timeout: 20_000 }),
});

const chainId = await client.getChainId();
const block = await client.getBlockNumber({ cacheTime: 0 });
console.log(`Robinhood mainnet chain ${chainId} @ block ${block}`);
console.log(`registry    ${GENERATION_SPRITE_MANIFEST.registry}`);
console.log(`generations ${GENERATION_SPRITE_MANIFEST.generations}\n`);
if (chainId !== GENERATION_SPRITE_MANIFEST.chainId) throw new Error("Wrong chain.");

const read = (address, abi, functionName, args) =>
  client.readContract({ address, abi, functionName, args });

const rows = [];
for (const tokenId of ids) {
  // Ownership/generation come from the collection; family and seed from the registry.
  const [generation, owner] = await Promise.all([
    read(GENERATION_SPRITE_MANIFEST.generations, GENERATION_ELIGIBILITY_ABI, "generation", [tokenId])
      .catch(() => null),
    read(GENERATION_SPRITE_MANIFEST.generations, GENERATION_ELIGIBILITY_ABI, "ownerOf", [tokenId])
      .catch(() => null),
  ]);
  const [familyId, seed] = await Promise.all([
    read(GENERATION_SPRITE_MANIFEST.registry, FAMILIES_REGISTRY_ABI, "familyOf", [tokenId]),
    read(GENERATION_SPRITE_MANIFEST.registry, FAMILIES_REGISTRY_ABI, "seedOf", [tokenId]),
  ]);
  const frames = await read(GENERATION_SPRITE_MANIFEST.registry, FAMILIES_REGISTRY_ABI, "frames", [familyId, seed]);
  // Resolve the frame the way the game does. Reading clips.idle.down directly
  // reports zero pixels for Colossus, whose vertical facings are intentionally
  // empty; spriteFrame falls back to the side view, which is what gets drawn.
  const sprites = decodeGenerationSprites(tokenId, familyId, seed, frames);
  const drawn = spriteFrame(sprites, "down", false, 0);
  const on = drawn.frame.rows.join("").split("").filter(pixel => pixel === "#").length;

  const song = composeSong(familyId, seed);
  rows.push({ tokenId, generation, owner, familyId, seed, on, song });

  console.log(`Friend #${tokenId}`);
  console.log(`  minted        ${owner ? `yes (generation ${generation})` : "no / unreadable"}`);
  console.log(`  family        ${familyId} ${GENERATION_FAMILY_NAMES[familyId]}`);
  console.log(`  seed          ${seed}`);
  console.log(`  sprite        ${sprites.frames.length} frames, ${on} lit pixels as drawn`
    + `${drawn.usedFallback ? ` (vertical facing falls back to ${drawn.resolvedFacing})` : ""}`);
  console.log(`  voice         ${song.voice.label} (${song.voice.wave})`);
  console.log(`  key / tempo   ${song.keyName} @ ${song.bpm} BPM`);
  for (const phrase of song.phrases.slice(0, 2)) {
    console.log(`  ${phrase.role.padEnd(9)}     ${phrase.notes.map(note => name(note.midi)).join(" ")}`);
  }
  console.log(`  Refrain       ${song.phrases[7].notes.map(note => name(note.midi)).join(" ")}\n`);
}

const playable = rows.filter(row => row.owner && Number(row.generation) >= 1);
const signatures = new Set(rows.map(row =>
  row.song.phrases.map(phrase => phrase.notes.map(note => note.midi).join(",")).join("|") + ":" + row.song.bpm));
const voices = new Set(rows.map(row => row.song.voice.label));
const lowest = Math.min(...rows.flatMap(row => row.song.phrases.flatMap(p => p.notes.map(n => n.midi))));
const highest = Math.max(...rows.flatMap(row => row.song.phrases.flatMap(p => p.notes.map(n => n.midi))));

console.log("─".repeat(60));
console.log(`token IDs read          ${rows.length}`);
console.log(`minted, generation >= 1 ${playable.length} (${playable.map(r => "#" + r.tokenId).join(", ")})`);
console.log(`distinct songs          ${signatures.size} / ${rows.length}`);
console.log(`distinct voices         ${voices.size} (${[...voices].join(", ")})`);
console.log(`pitch range             ${name(lowest)} .. ${name(highest)}`);
if (signatures.size !== rows.length) throw new Error("Two real Friends produced the same song.");
if (lowest < 40 || highest > 92) throw new Error("A real Friend composed outside the audible band.");
const blank = rows.filter(row => row.on === 0);
if (blank.length) throw new Error(`Friends render no pixels: ${blank.map(r => "#" + r.tokenId).join(", ")}`);
console.log("\nAll real-Friend compositions are distinct and in range.");

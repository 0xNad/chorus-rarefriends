/**
 * Render a sheet of real mainnet Friends: each one's genuine on-chain sprite
 * beside the song its own family and seed compose.
 *
 * Every value here is read live from Robinhood mainnet through public view/pure
 * functions. No wallet, key or signature is involved, and nothing is simulated:
 * this is a verification artifact, not a screenshot of the game.
 *
 * Usage: node --experimental-strip-types scripts/render-friend-sheet.mjs [out.png] [tokenId ...]
 */
import { createPublicClient, http } from "viem";
import {
  FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST, GENERATION_FAMILY_NAMES,
  decodeGenerationSprites, spriteFrame,
} from "@rarefriends/friendsdk/sprites";
import { GENERATION_ELIGIBILITY_ABI } from "@rarefriends/friendsdk/identity";
import { composeSong } from "../games/chorus/composition.ts";

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = midi => `${NOTE[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const out = process.argv[2] ?? "./artifacts/real-friends.png";
// One real, minted, generation >= 1 Friend per family, found by probing mainnet.
const ids = (process.argv.slice(3).length ? process.argv.slice(3) : ["444", "87846", "40000", "65001", "15000", "7730", "20838"])
  .map(value => BigInt(value));

const client = createPublicClient({
  transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { retryCount: 2, timeout: 25_000 }),
});
const chainId = await client.getChainId();
const block = await client.getBlockNumber({ cacheTime: 0 });
if (chainId !== GENERATION_SPRITE_MANIFEST.chainId) throw new Error("Wrong chain.");

const cards = [];
for (const tokenId of ids) {
  const generation = await client.readContract({
    address: GENERATION_SPRITE_MANIFEST.generations, abi: GENERATION_ELIGIBILITY_ABI,
    functionName: "generation", args: [tokenId],
  });
  const [familyId, seed] = await Promise.all([
    client.readContract({ address: GENERATION_SPRITE_MANIFEST.registry, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [tokenId] }),
    client.readContract({ address: GENERATION_SPRITE_MANIFEST.registry, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [tokenId] }),
  ]);
  const frames = await client.readContract({
    address: GENERATION_SPRITE_MANIFEST.registry, abi: FAMILIES_REGISTRY_ABI,
    functionName: "frames", args: [familyId, seed],
  });
  const sprites = decodeGenerationSprites(tokenId, familyId, seed, frames);
  // Resolve the drawn frame the way the game does, so Colossus uses its side view.
  const rows = spriteFrame(sprites, "down", false, 0).frame.rows;
  const song = composeSong(familyId, seed);
  cards.push({ tokenId, generation: Number(generation), familyId, seed, rows, song });
  console.log(`#${tokenId} ${GENERATION_FAMILY_NAMES[familyId].padEnd(10)} ${song.voice.label.padEnd(14)} ${song.keyName} @ ${song.bpm} BPM`);
}

const PX = 7;
const sprite = rows => rows.flatMap((row, y) => [...row]
  .map((pixel, x) => pixel === "#" ? `<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}"/>` : "")
  .filter(Boolean)).join("");

const ribbon = song => song.phrases[7].notes.map(note => {
  const height = 10 + ((note.midi - 40) / 52) * 90;
  return `<div class="bar" style="height:${height}%"></div>`;
}).join("");

const html = `<!doctype html><meta charset="utf-8"><style>
  :root { color-scheme: dark; }
  body { margin:0; background:#05060a; color:#fff;
         font:500 13px/1.4 ui-sans-serif,system-ui,sans-serif; padding:26px; }
  h1 { margin:0 0 4px; font-size:15px; letter-spacing:.24em; text-transform:uppercase; color:#ccff00; }
  .sub { margin:0 0 20px; font-size:11.5px; color:rgba(255,255,255,.5); }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .card { border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:12px;
          background:rgba(255,255,255,.03); display:grid; gap:7px; }
  .art { display:flex; align-items:center; gap:11px; }
  svg { fill:#fff; flex:0 0 auto; }
  .id { font-weight:700; font-size:14px; }
  .fam { font-size:11px; color:rgba(255,255,255,.5); }
  .voice { color:#ccff00; font-size:12px; font-weight:600; }
  .meta { font-size:11px; color:rgba(255,255,255,.55); font-variant-numeric:tabular-nums; }
  .ribbon { display:flex; align-items:flex-end; gap:3px; height:34px;
            border-bottom:1px solid rgba(255,255,255,.16); }
  .bar { flex:1 1 0; background:rgba(204,255,0,.62); border-radius:2px 2px 0 0; }
  .notes { font-size:10px; color:rgba(255,255,255,.42); font-variant-numeric:tabular-nums; }
  .foot { margin-top:18px; font-size:10.5px; color:rgba(255,255,255,.38); }
</style>
<h1>Chorus &middot; seven real Friends, seven voices</h1>
<p class="sub">Read live from Robinhood mainnet (chain ${chainId}) at block ${block}. Sprites are each token's
genuine on-chain artwork; the bars are its Refrain drawn at pitch. Public reads only &mdash; no wallet, no signature.</p>
<div class="grid">
${cards.map(card => `<div class="card">
  <div class="art">
    <svg width="${16 * PX}" height="${16 * PX}" viewBox="0 0 ${16 * PX} ${16 * PX}" shape-rendering="crispEdges">${sprite(card.rows)}</svg>
    <div>
      <div class="id">#${card.tokenId}</div>
      <div class="fam">${GENERATION_FAMILY_NAMES[card.familyId]} &middot; gen ${card.generation}</div>
      <div class="fam">seed ${card.seed}</div>
    </div>
  </div>
  <div class="voice">${card.song.voice.label}</div>
  <div class="meta">key ${card.song.keyName} &middot; ${card.song.bpm} BPM &middot; ${card.song.voice.wave}</div>
  <div class="ribbon">${ribbon(card.song)}</div>
  <div class="notes">${card.song.phrases[7].notes.map(note => noteName(note.midi)).join(" ")}</div>
</div>`).join("")}
</div>
<p class="foot">Generations ${GENERATION_SPRITE_MANIFEST.generations} &middot; registry ${GENERATION_SPRITE_MANIFEST.registry}</p>`;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.locator("body").screenshot({ path: out });
await browser.close();
console.log(`\nwrote ${out}`);

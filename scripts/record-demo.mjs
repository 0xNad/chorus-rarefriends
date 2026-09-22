/**
 * Record a demo of Chorus: real runtime, real composed audio.
 *
 * Playwright records video but never audio, so the page's own audio graph is
 * tapped instead: AudioNode.connect is wrapped so anything reaching a context's
 * destination is also routed to a MediaStreamDestination that MediaRecorder
 * captures. The soundtrack is therefore the game's actual output, not a
 * reproduction rendered separately.
 *
 * Usage: node scripts/record-demo.mjs [out.mp4]
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ffmpeg from "ffmpeg-static";
import { chromium } from "playwright";
import { buildGame } from "@rarefriends/friendsdk/build";
import { createGameServer } from "@rarefriends/friendsdk/serve";

// The SDK's read-only wallet/RPC fixture is shipped but not exported, so it is
// loaded by path. This is a developer recording script, never part of a build.
const fixtureUrl = pathToFileURL(
  fileURLToPath(new URL("../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs", import.meta.url)));
const { installFixture, createArtworkFixture } = await import(fixtureUrl.href);

const out = resolve(process.argv[2] ?? "./artifacts/chorus-demo.mp4");
const game = fileURLToPath(new URL("../games/chorus/", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "chorus-demo-"));
const WIDTH = 1000, HEIGHT = 720;

/** Tap every AudioContext that reaches its destination, and record it. */
const TAP = () => {
  const recorders = [];
  globalThis.__chorusAudio = recorders;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...rest) {
    const result = connect.call(this, destination, ...rest);
    try {
      const context = this.context;
      if (destination === context.destination && !context.__tapped) {
        context.__tapped = true;
        const sink = context.createMediaStreamDestination();
        connect.call(this, sink);
        const chunks = [];
        const recorder = new MediaRecorder(sink.stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.start();
        recorders.push({ recorder, chunks, started: performance.now() });
      }
    } catch { /* a tap must never break playback */ }
    return result;
  };
};

let build, server, browser;
try {
  build = await buildGame(game, { outdir: join(work, "dist") });
  server = createGameServer(build.outdir);
  await new Promise((ok, no) => { server.once("error", no); server.listen(0, "127.0.0.1", ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-features=AudioServiceOutOfProcess"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    reducedMotion: "no-preference",
    recordVideo: { dir: join(work, "video"), size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.addInitScript(TAP);
  await installFixture(page, origin, { artworkCall: await createArtworkFixture() });
  // The fixture pins the preview roll so tests are deterministic. A demo should
  // show the real spread of phrases, so browser entropy is restored here.
  await page.addInitScript(() => {
    // The fixture shadows getRandomValues with an own property that pins the
    // roll. Deleting it uncovers the native Crypto.prototype method, so the
    // demo shows the real spread of phrases instead of the same one repeatedly.
    delete globalThis.crypto.getRandomValues;
  });

  const frame = page.frameLocator("iframe");
  const confirm = async () => {
    const button = page.getByRole("button", { name: "Confirm preview", exact: true });
    await button.waitFor(); await button.click(); await button.waitFor({ state: "hidden" });
  };
  const beat = ms => page.waitForTimeout(ms);

  await page.goto(origin);
  await page.getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  await frame.locator(".chorus").waitFor();
  await beat(1200);

  // A pack, so the demo is not a wall of confirmations.
  for (let pack = 0; pack < 2; pack++) {
    await frame.getByRole("button", { name: /^Buy 5/ }).click();
    await confirm();
    await beat(500);
  }
  await beat(500);

  // Four captures: let the first echo be performed in time, skip the rest.
  for (let round = 0; round < 6; round++) {
    await frame.getByRole("button", { name: "Capture a phrase", exact: true }).click();
    await confirm();
    const skip = frame.getByRole("button", { name: "Skip the echo", exact: true });
    await skip.waitFor({ timeout: 25_000 });
    if (round === 0) {
      // Echo on the composed cadence: Friend #7730 runs at 77 BPM.
      await frame.locator(".chorus-pad").evaluate(async (pad, ms) => {
        for (let i = 0; i < 4; i++) {
          pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          if (i < 3) await new Promise(r => setTimeout(r, ms));
        }
      }, 60_000 / 77);
      await beat(1200);
    }
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await beat(round === 0 ? 600 : 250);
  }

  // The payoff: everything held, in order.
  await beat(500);
  await frame.getByRole("button", { name: /^Play song/ }).click();
  // Let the whole arrangement play out; this is the point of the game.
  await beat(20_000);
  await beat(1200);

  // The game's audio graph lives in the sandboxed child, so the recorders are
  // in that frame's globalThis, not the top-level page's.
  const audio = await frame.locator("body").evaluate(async () => {
    const encode = blob => new Promise(done => {
      const reader = new FileReader();
      reader.onloadend = () => done(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
    const results = [];
    for (const { recorder, chunks } of globalThis.__chorusAudio ?? []) {
      if (recorder.state !== "inactive") {
        await new Promise(done => { recorder.onstop = done; recorder.stop(); });
      }
      if (chunks.length) results.push(await encode(new Blob(chunks, { type: "audio/webm" })));
    }
    return results;
  });

  await context.close();
  await browser.close(); browser = null;

  const videoDir = join(work, "video");
  const [videoFile] = (await readdir(videoDir)).filter(f => f.endsWith(".webm"));
  if (!videoFile) throw new Error("Playwright produced no video.");
  const video = join(videoDir, videoFile);

  const tracks = [];
  for (const [index, b64] of audio.entries()) {
    const file = join(work, `audio-${index}.webm`);
    await writeFile(file, Buffer.from(b64, "base64"));
    tracks.push(file);
  }
  console.log(`video: ${video}\naudio tracks captured: ${tracks.length}`);

  await mkdir(dirname(out), { recursive: true });
  const args = ["-y", "-i", video];
  for (const t of tracks) args.push("-i", t);
  if (tracks.length > 1) {
    args.push("-filter_complex", `${tracks.map((_, i) => `[${i + 1}:a]`).join("")}amix=inputs=${tracks.length}:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]");
  } else if (tracks.length === 1) {
    args.push("-map", "0:v", "-map", "1:a");
  } else {
    args.push("-map", "0:v");
  }
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", ...(tracks.length ? ["-c:a", "aac", "-b:a", "160k"] : []), out);
  execFileSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`wrote ${out}`);
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  await build?.close();
  await rm(work, { recursive: true, force: true });
}

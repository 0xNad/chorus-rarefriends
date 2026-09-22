/**
 * Browser check for Chorus, run against the SDK's real runtime with its
 * read-only wallet/RPC fixtures. The fixture pins the preview roll, so every
 * settle resolves to outcome 1, "Verse I".
 *
 * Usage: node test.mjs [width] [screenshot.png]
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { testGame } from "@rarefriends/friendsdk/testing";

const here = fileURLToPath(new URL(".", import.meta.url));
const width = Number(process.argv[2] ?? 960);
const shot = process.argv[3];

const result = await testGame(here, {
  width,
  height: width < 500 ? 720 : 800,
  timeout: 30_000,
  ...(shot ? { screenshot: shot } : {}),
  check: async ({ page, game, friendId }) => {
    assert.equal(friendId, 7730n, "fixture Friend");
    // Every economy action is confirmed in the trusted runtime, outside the sandbox.
    const confirm = async () => {
      const button = page.getByRole("button", { name: "Confirm preview", exact: true });
      await button.waitFor();
      await button.click();
      await button.waitFor({ state: "hidden" });
    };

    // The Friend's canonical artwork must actually resolve from the registry.
    await game.getByRole("img", { name: /Friend #7730 canonical artwork/ }).waitFor();
    // Family 5 / seed 7730 compose the Hover glass voice in D at 77 BPM.
    await game.getByText(/Hover glass · key D · 77 BPM/).waitFor();

    const rail = game.getByRole("listitem");
    assert.equal(await rail.count(), 8, "eight phrase slots");
    await game.getByText("0/8 phrases", { exact: true }).waitFor();

    // Buy two, so the lock assertions below are meaningful: with a Tone still
    // in hand, an unguarded Capture button really could start a second capture
    // over the top of the first. With only one Tone it would read as disabled
    // simply because there was nothing left to spend.
    await game.getByRole("button", { name: /^Buy Tone/ }).click();
    await confirm();
    await game.getByText("1 Tones", { exact: true }).waitFor();
    await game.getByRole("button", { name: /^Buy Tone/ }).click();
    await confirm();
    await game.getByText("2 Tones", { exact: true }).waitFor();

    // Using a Tone is confirmed in the trusted runtime; in preview mode the
    // settle that follows it is not a mutation, so it needs no second prompt.
    await game.getByRole("button", { name: "Capture a phrase", exact: true }).click();
    await confirm();
    await game.getByText("1 Tones", { exact: true }).waitFor();

    // Regression: while a phrase is playing or being echoed, the capture and
    // play controls must stay locked. They did not, which let a second capture
    // start mid-reveal and spend another Tone over the top of the first.
    assert.equal(
      await game.getByRole("button", { name: "Capture a phrase", exact: true }).isDisabled(),
      true, "capture stays locked while a phrase is playing");
    assert.equal(
      await game.getByRole("button", { name: /^Play song/ }).isDisabled(),
      true, "play song stays locked while a phrase is playing");

    // The echo is offered after the phrase plays, and is always skippable.
    const skip = game.getByRole("button", { name: "Skip the echo", exact: true });
    await skip.waitFor({ timeout: 20_000 });
    assert.equal(
      await game.getByRole("button", { name: "Capture a phrase", exact: true }).isDisabled(),
      true, "capture stays locked during the echo");
    // Tapping in time means many fast taps in one place, which was selecting the
    // pad label and the text around it.
    assert.equal(
      await game.locator(".chorus-pad").evaluate(node => getComputedStyle(node).userSelect),
      "none", "the echo pad is not selectable");
    await skip.click();

    // The spare Tone survived: exactly one capture ran.
    await game.getByText("1 Tones", { exact: true }).waitFor();

    // Outcome 1 is Verse I; holding it must light the first rail slot.
    await game.getByText("1/8 phrases", { exact: true }).waitFor();
    assert.match((await rail.first().getAttribute("class")) ?? "", /held/, "Verse I held");

    await game.getByRole("button", { name: /^Play song/ }).click();
    const stop = game.getByRole("button", { name: "Stop", exact: true });
    await stop.waitFor();
    await stop.click();

    // Redeeming the only copy returns the RF and darkens the phrase again.
    await game.getByRole("button", { name: "Phrases", exact: true }).click();
    await game.getByRole("button", { name: "Redeem one", exact: true }).first().click();
    await confirm();
    await game.getByText("0/8 phrases", { exact: true }).waitFor();
    assert.doesNotMatch((await rail.first().getAttribute("class")) ?? "", /held/, "Verse I released");
    await game.getByRole("button", { name: /^Close / }).first().click();

    // Accessibility controls required for an SDK game with audio and motion.
    await game.getByRole("button", { name: "Settings", exact: true }).click();
    // The label states the current setting; sound starts on for a music game.
    await game.getByRole("button", { name: "Sound on", exact: true }).click();
    await game.getByRole("button", { name: "Sound off", exact: true }).click();
    await game.getByRole("button", { name: "Sound on", exact: true }).waitFor();
    await game.getByLabel("Reduce motion").check();
    await game.getByRole("button", { name: /^Close / }).first().click();
    // The in-game toggle must reach the CSS, not only the canvas.
    assert.equal(await game.locator(".chorus").getAttribute("data-reduced-motion"), "true",
      "Reduce motion is applied to the game root");

    // The About panel explains where the song comes from.
    await game.getByRole("button", { name: "About", exact: true }).click();
    await game.getByText(/familyOf\(tokenId\)/).first().waitFor();
    await game.getByRole("button", { name: /^Close / }).first().click();

    // Echo scoring, played in time. Friend #7730 composes at 77 BPM and Verse I
    // is four even beats, so the pad is driven from inside the page on that
    // cadence: keeping the timing path in-page avoids adding driver round-trip
    // latency to every note, which would read as a miss.
    await game.getByRole("button", { name: /^Buy Tone/ }).click();
    await confirm();
    await game.getByRole("button", { name: "Capture a phrase", exact: true }).click();
    await confirm();
    const beat = 60_000 / 77;
    const performed = await game.locator(".chorus").evaluate(async (root, ms) => {
      // Arm before the pad exists so the first note is not already late.
      const pad = await new Promise(resolve => {
        const tick = () => { const node = document.querySelector(".chorus-pad"); node ? resolve(node) : setTimeout(tick, 8); };
        tick();
      });
      for (let index = 0; index < 4; index++) {
        pad.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        if (index < 3) await new Promise(resolve => setTimeout(resolve, ms));
      }
      await new Promise(resolve => setTimeout(resolve, 450));
      return document.querySelector(".chorus-feedback")?.textContent ?? "";
    }, beat);
    assert.match(performed, /mastered/, `echo played in time should master the phrase, got: ${performed}`);
    await game.getByText("1/8 phrases", { exact: true }).waitFor();
    // Mastery is non-financial and must not touch the ledger.
    assert.match(await game.locator(".chorus-resonance").textContent() ?? "", /Resonance [1-9]/, "Resonance rises");

    // A pack is one trusted prompt for five Tones, so filling the rail does not
    // cost a confirmation per Tone.
    const before = Number((await game.locator(".chorus-meters").textContent() ?? "").match(/(\d+) Tones/)?.[1] ?? "-1");
    await game.getByRole("button", { name: /^Buy 5/ }).click();
    await confirm();
    await game.getByText(`${before + 5} Tones`, { exact: true }).waitFor();
  },
});
console.log("chorus browser check passed:", JSON.stringify(result));

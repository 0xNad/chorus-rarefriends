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

    await game.getByRole("button", { name: /^Buy Tone/ }).click();
    await confirm();
    await game.getByText("1 Tones", { exact: true }).waitFor();

    // Using a Tone is confirmed in the trusted runtime; in preview mode the
    // settle that follows it is not a mutation, so it needs no second prompt.
    await game.getByRole("button", { name: "Capture a phrase", exact: true }).click();
    await confirm();

    // The echo is offered after the phrase plays, and is always skippable.
    const skip = game.getByRole("button", { name: "Skip the echo", exact: true });
    await skip.waitFor({ timeout: 20_000 });
    await skip.click();

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

    // Leave the screenshot on a held phrase rather than an empty rail.
    await game.getByRole("button", { name: /^Buy Tone/ }).click();
    await confirm();
    await game.getByRole("button", { name: "Capture a phrase", exact: true }).click();
    await confirm();
    const skipAgain = game.getByRole("button", { name: "Skip the echo", exact: true });
    await skipAgain.waitFor({ timeout: 20_000 });
    await skipAgain.click();
    await game.getByText("1/8 phrases", { exact: true }).waitFor();
  },
});
console.log("chorus browser check passed:", JSON.stringify(result));

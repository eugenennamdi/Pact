import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { issueChallenge, parseChallengeMessage, verifyChallenge } from "./auth";
import { InMemoryProductRepository } from "./repository";

const WALLET = getAddress("0x1111111111111111111111111111111111111111");
const OTHER_WALLET = getAddress("0x2222222222222222222222222222222222222222");
const ORIGIN = new URL("https://pact.example");
const SIGNATURE = `0x${"11".repeat(65)}`;
const NOW = new Date("2026-10-03T12:00:00.000Z");

function recover(address: Address = WALLET) {
  return async () => Promise.resolve(address);
}

describe("wallet authentication challenges", () => {
  it("issues and verifies a canonical Arc Testnet challenge", async () => {
    const repository = new InMemoryProductRepository();
    const challenge = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    expect(challenge.chainId).toBe(5_042_002);
    expect(challenge.domain).toBe("pact.example");
    expect(parseChallengeMessage(challenge.message).nonce).toBe(
      challenge.nonce,
    );
    await expect(
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: challenge.message,
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 1_000),
        recoverAddress: recover(),
      }),
    ).resolves.toBe(WALLET);
  });

  it("rejects an invalid wallet", async () => {
    await expect(
      issueChallenge({
        repository: new InMemoryProductRepository(),
        walletAddress: "not-an-address",
        publicOrigin: ORIGIN,
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  it("rejects an expired challenge", async () => {
    const repository = new InMemoryProductRepository();
    const challenge = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    await expect(
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: challenge.message,
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 301_000),
        recoverAddress: recover(),
      }),
    ).rejects.toThrow("CHALLENGE_EXPIRED");
  });

  it.each([
    ["wrong chain", "Chain ID: 5042002", "Chain ID: 1"],
    [
      "wrong domain",
      "pact.example wants you to sign in",
      "evil.example wants you to sign in",
    ],
    ["wrong URI", "URI: https://pact.example", "URI: https://evil.example"],
    ["tampered statement", "Sign in to Pact", "Authorize funds in Pact"],
  ])("rejects %s binding", async (_label, original, replacement) => {
    const repository = new InMemoryProductRepository();
    const challenge = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    await expect(
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: challenge.message.replace(original, replacement),
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 1_000),
        recoverAddress: recover(),
      }),
    ).rejects.toThrow();
  });

  it("rejects a signature recovered to a different wallet", async () => {
    const repository = new InMemoryProductRepository();
    const challenge = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    await expect(
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: challenge.message,
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 1_000),
        recoverAddress: recover(OTHER_WALLET),
      }),
    ).rejects.toThrow("SIGNER_MISMATCH");
  });

  it("rejects replay and permits only one concurrent nonce consumer", async () => {
    const repository = new InMemoryProductRepository();
    const challenge = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    const attempt = () =>
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: challenge.message,
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 1_000),
        recoverAddress: recover(),
      });
    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    await expect(attempt()).rejects.toThrow("NONCE_ALREADY_CONSUMED");
  });

  it("invalidates the previous active challenge for a wallet/domain", async () => {
    const repository = new InMemoryProductRepository();
    const first = await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: NOW,
    });
    await issueChallenge({
      repository,
      walletAddress: WALLET,
      publicOrigin: ORIGIN,
      now: new Date(NOW.getTime() + 1_000),
    });
    await expect(
      verifyChallenge({
        repository,
        publicOrigin: ORIGIN,
        message: first.message,
        signature: SIGNATURE,
        now: new Date(NOW.getTime() + 2_000),
        recoverAddress: recover(),
      }),
    ).rejects.toThrow("NONCE_ALREADY_CONSUMED");
  });
});

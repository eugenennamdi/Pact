"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CreatePactResponseDto } from "../../../packages/product/src/public-contract";
import { ARC_TESTNET_CHAIN_ID } from "./wallet";
import { ProductApiFailure, createProductApiClient } from "./product-client";
import { ErrorNotice } from "./error-notice";
import { useWallet, WalletControls } from "./wallet-boundary";

const api = createProductApiClient();

export function CreatePact() {
  const wallet = useWallet();
  const [repository, setRepository] = useState("");
  const [pullRequest, setPullRequest] = useState("");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<CreatePactResponseDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      wallet.address === null ||
      !wallet.authenticated ||
      wallet.chainId !== ARC_TESTNET_CHAIN_ID
    ) {
      setError(new Error("AUTH_REQUIRED"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setResult(
        await api.createPact(
          {
            repository,
            pullRequest: Number(pullRequest),
            provider,
            amount,
          },
          `create:${crypto.randomUUID()}`,
        ),
      );
    } catch (nextError) {
      if (
        nextError instanceof ProductApiFailure &&
        nextError.category === "AUTH_REQUIRED"
      ) {
        wallet.invalidateAuthentication();
      }
      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid">
      <div>
        <WalletControls />
        <form className="card stack" onSubmit={(event) => void submit(event)}>
          <h2>Create a GitHub PR Pact</h2>
          <label>
            GitHub repository
            <input
              name="repository"
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repository"
              required
            />
          </label>
          <label>
            Pull request number
            <input
              name="pullRequest"
              type="number"
              min="1"
              step="1"
              value={pullRequest}
              onChange={(event) => setPullRequest(event.target.value)}
              required
            />
          </label>
          <label>
            Provider wallet address
            <input
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="0x…"
              required
            />
          </label>
          <label>
            USDC amount
            <input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.10"
              required
            />
          </label>
          <button
            type="submit"
            disabled={
              submitting ||
              !wallet.authenticated ||
              wallet.chainId !== ARC_TESTNET_CHAIN_ID
            }
          >
            Create draft
          </button>
          {error !== null && <ErrorNotice error={error} />}
        </form>
      </div>
      <section className="card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">Server-owned preview</h2>
        {result === null ? (
          <p>
            The network, condition hash, deadline policy and deployment identity
            will appear here after the server validates the open PR.
          </p>
        ) : (
          <>
            <dl>
              <dt>Network</dt>
              <dd>{result.network}</dd>
              <dt>Condition</dt>
              <dd>
                {result.repository}#{result.pullRequest} merged to{" "}
                {result.baseBranch}
              </dd>
              <dt>Condition hash</dt>
              <dd className="hash">{result.conditionHash}</dd>
              <dt>Amount</dt>
              <dd>{result.amountBaseUnits} base units</dd>
              <dt>Provider</dt>
              <dd className="hash">{result.provider}</dd>
              <dt>Completion policy</dt>
              <dd>{result.deadlinePolicy.completionOffsetSeconds} seconds</dd>
              <dt>Expiry policy</dt>
              <dd>{result.deadlinePolicy.expiryOffsetSeconds} seconds</dd>
              <dt>Commerce</dt>
              <dd className="hash">{result.commerceAddress}</dd>
              <dt>Evaluator</dt>
              <dd className="hash">{result.evaluatorAddress}</dd>
            </dl>
            <Link className="button-link" href={`/pacts/${result.publicSlug}`}>
              Open Pact
            </Link>
          </>
        )}
      </section>
    </div>
  );
}

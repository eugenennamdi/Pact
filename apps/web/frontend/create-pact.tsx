"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CreatePactResponseDto } from "../../../packages/product/src/public-contract";
import { ARC_TESTNET_CHAIN_ID } from "./wallet";
import { ProductApiFailure, createProductApiClient } from "./product-client";
import { ErrorNotice } from "./error-notice";
import { useWallet, WalletRequirement } from "./wallet-boundary";
import { CopyButton, NetworkBadge } from "./presentation";
import {
  COMPLETION_DEADLINE_POLICY,
  DEADLINE_ANCHOR_EXPLANATION,
  MAXIMUM_LIFETIME_POLICY,
} from "./deadline-copy";

const api = createProductApiClient();

function displayUsdc(baseUnits: string): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  const value = baseUnits.padStart(7, "0");
  const whole = value.slice(0, -6);
  const fraction = value.slice(-6).replace(/0+$/, "");
  return fraction.length === 0 ? `${whole} USDC` : `${whole}.${fraction} USDC`;
}

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
      <div className="stack">
        <form className="card stack" onSubmit={(event) => void submit(event)}>
          <div className="card-header">
            <div className="card-title-group">
              <h2>New Pact instruction</h2>
              <p className="card-description">
                Lock USDC against an objectively verifiable GitHub merge event.
              </p>
            </div>
          </div>

          <div className="form-group">
            <label>
              <span>GitHub repository</span>
              <span className="label-hint">Owner and repository name</span>
              <input
                name="repository"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                placeholder="owner/repository"
                required
              />
            </label>
          </div>

          <div className="form-group">
            <label>
              <span>Pull request number</span>
              <span className="label-hint">
                The PR whose merge triggers escrow settlement
              </span>
              <input
                name="pullRequest"
                type="number"
                min="1"
                step="1"
                value={pullRequest}
                onChange={(event) => setPullRequest(event.target.value)}
                placeholder="1"
                required
              />
            </label>
          </div>

          <div className="form-group">
            <label>
              <span>Provider wallet address</span>
              <span className="label-hint">
                Recipient EVM address receiving USDC upon merge
              </span>
              <input
                name="provider"
                className="font-mono"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="0x…"
                required
              />
            </label>
          </div>

          <div className="form-group">
            <label>
              <span>USDC amount</span>
              <span className="label-hint">
                Total escrow locked in ERC-8183 (e.g. 0.10)
              </span>
              <input
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.10"
                required
              />
            </label>
          </div>

          <WalletRequirement />

          <div className="actions" style={{ marginTop: "0.5rem" }}>
            <button
              type="submit"
              disabled={
                submitting ||
                !wallet.authenticated ||
                wallet.chainId !== ARC_TESTNET_CHAIN_ID
              }
            >
              {submitting ? "Creating draft instruction…" : "Create draft"}
            </button>
          </div>

          {error !== null && <ErrorNotice error={error} />}
        </form>
      </div>

      <section
        className="card"
        aria-labelledby="preview-heading"
        style={{ height: "fit-content" }}
      >
        <div className="card-header">
          <div className="card-title-group">
            <h2 id="preview-heading">Deterministic preview</h2>
            <p className="card-description">
              Authoritative parameters governed by Pact and the Arc settlement
              kernel.
            </p>
          </div>
          {result !== null && (
            <span className="badge badge-verified">Draft created</span>
          )}
        </div>

        {result === null ? (
          <div
            className="stack"
            style={{ gap: "1rem", color: "var(--text-secondary)" }}
          >
            <p style={{ margin: 0 }}>
              The target network, condition hash, deadline policy, and
              deployment identity will be derived after the server validates the
              open pull request against GitHub.
            </p>
            <div
              style={{
                background: "var(--bg-subtle)",
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <span className="eyebrow" style={{ marginBottom: "0.5rem" }}>
                Pre-configured protocol constraints
              </span>
              <dl style={{ margin: 0 }}>
                <dt>Network</dt>
                <dd>Arc Testnet (5042002)</dd>
                <dt>Escrow standard</dt>
                <dd>ERC-8183</dd>
                <dt>Evaluator</dt>
                <dd>PactEvaluator.sol</dd>
                <dt>Verification rule</dt>
                <dd>Positive-only GitHub PR merge</dd>
              </dl>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: "1.25rem" }}>
            <div>
              <span className="eyebrow" style={{ marginBottom: "0.5rem" }}>
                Human-readable terms
              </span>
              <dl>
                <dt>Condition</dt>
                <dd>
                  <strong>
                    {result.repository}#{result.pullRequest}
                  </strong>{" "}
                  merged into <code>{result.baseBranch}</code>
                </dd>
                <dt>Escrow amount</dt>
                <dd>
                  <strong>{displayUsdc(result.amountBaseUnits)}</strong>{" "}
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.8125rem",
                    }}
                  >
                    ({result.amountBaseUnits} base units)
                  </span>
                </dd>
                <dt>Provider</dt>
                <dd>
                  <span className="tech-address-wrapper">
                    <code className="tech-hash">{result.provider}</code>
                    <CopyButton text={result.provider} label="Copy address" />
                  </span>
                </dd>
                <dt>Network</dt>
                <dd>
                  <NetworkBadge
                    network={result.network}
                    chainId={result.chainId}
                  />
                </dd>
              </dl>
            </div>

            <div
              style={{
                borderTop: "1px solid var(--border-subtle)",
                paddingTop: "1rem",
              }}
            >
              <span className="eyebrow" style={{ marginBottom: "0.5rem" }}>
                Technical protocol parameters
              </span>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.8125rem",
                  margin: "0 0 1rem",
                }}
              >
                {DEADLINE_ANCHOR_EXPLANATION}
              </p>
              <dl>
                <dt>Condition hash</dt>
                <dd>
                  <span className="tech-address-wrapper">
                    <code className="tech-hash">{result.conditionHash}</code>
                    <CopyButton
                      text={result.conditionHash}
                      label="Copy condition hash"
                    />
                  </span>
                </dd>
                <dt>Completion deadline</dt>
                <dd>{COMPLETION_DEADLINE_POLICY}</dd>
                <dt>Maximum lifetime</dt>
                <dd>{MAXIMUM_LIFETIME_POLICY}</dd>
                <dt>Commerce contract</dt>
                <dd>
                  <span className="tech-address-wrapper">
                    <code className="tech-hash">{result.commerceAddress}</code>
                    <CopyButton
                      text={result.commerceAddress}
                      label="Copy address"
                    />
                  </span>
                </dd>
                <dt>Evaluator contract</dt>
                <dd>
                  <span className="tech-address-wrapper">
                    <code className="tech-hash">{result.evaluatorAddress}</code>
                    <CopyButton
                      text={result.evaluatorAddress}
                      label="Copy address"
                    />
                  </span>
                </dd>
              </dl>
            </div>

            <div className="actions" style={{ margin: "0.5rem 0 0 0" }}>
              <Link
                className="button-link"
                href={`/pacts/${result.publicSlug}`}
              >
                Open Pact workspace →
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

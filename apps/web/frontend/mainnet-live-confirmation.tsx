"use client";

import { useEffect, useState } from "react";
import { HashDisplay } from "./presentation";

interface ReceiptResult {
  readonly blockHash?: string;
  readonly blockNumber?: string;
  readonly status?: string;
  readonly transactionHash?: string;
}

async function rpc(
  method: "eth_chainId" | "eth_getTransactionReceipt",
  params: readonly unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch("https://rpc.mainnet.arc.io", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("MAINNET_RPC_UNAVAILABLE");
  const body = (await response.json()) as {
    readonly result?: unknown;
    readonly error?: unknown;
  };
  if (body.error !== undefined || body.result === undefined)
    throw new Error("MAINNET_RPC_UNAVAILABLE");
  return body.result;
}

export function MainnetLiveConfirmation({
  transactionHash,
  expectedBlockHash,
  expectedBlockNumber,
}: {
  readonly transactionHash: string;
  readonly expectedBlockHash: string;
  readonly expectedBlockNumber: string;
}) {
  const [state, setState] = useState<
    | { readonly kind: "LOADING" }
    | { readonly kind: "UNAVAILABLE" }
    | { readonly kind: "MISMATCH" }
    | { readonly kind: "CONFIRMED"; readonly receipt: ReceiptResult }
  >({ kind: "LOADING" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    void (async () => {
      try {
        const chainId = await rpc("eth_chainId", [], controller.signal);
        const receipt = (await rpc(
          "eth_getTransactionReceipt",
          [transactionHash],
          controller.signal,
        )) as ReceiptResult;
        const blockNumber =
          typeof receipt.blockNumber === "string"
            ? BigInt(receipt.blockNumber).toString()
            : "";
        if (
          chainId !== "0x13b2" ||
          receipt.status !== "0x1" ||
          receipt.transactionHash?.toLowerCase() !==
            transactionHash.toLowerCase() ||
          receipt.blockHash?.toLowerCase() !==
            expectedBlockHash.toLowerCase() ||
          blockNumber !== expectedBlockNumber
        ) {
          if (active) setState({ kind: "MISMATCH" });
          return;
        }
        if (active) setState({ kind: "CONFIRMED", receipt });
      } catch {
        if (active) setState({ kind: "UNAVAILABLE" });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [expectedBlockHash, expectedBlockNumber, transactionHash]);

  return (
    <section className="card" aria-labelledby="live-confirmation-heading">
      <div className="card-header">
        <div className="card-title-group">
          <h2 id="live-confirmation-heading">Live chain confirmation</h2>
          <p className="card-description">
            Independent, on-demand query to the public Arc Mainnet RPC node.
          </p>
        </div>
        <span
          className={`badge ${
            state.kind === "CONFIRMED"
              ? "badge-verified"
              : state.kind === "LOADING"
                ? "badge-pending"
                : state.kind === "MISMATCH"
                  ? "badge-error"
                  : "badge-neutral"
          }`}
        >
          <span className="badge-dot" />
          {state.kind === "CONFIRMED"
            ? "Live confirmed"
            : state.kind === "LOADING"
              ? "Querying Arc RPC…"
              : state.kind === "MISMATCH"
                ? "Receipt mismatch"
                : "Live RPC unavailable"}
        </span>
      </div>

      {state.kind === "LOADING" && (
        <div style={{ padding: "1rem 0", color: "var(--text-secondary)" }}>
          <p role="status" style={{ margin: 0, fontSize: "0.875rem" }}>
            Reading transaction receipt directly from Arc Mainnet
            (https://rpc.mainnet.arc.io)…
          </p>
        </div>
      )}

      {state.kind === "UNAVAILABLE" && (
        <div className="notice" style={{ margin: "0.5rem 0" }}>
          <p role="status" style={{ margin: 0 }}>
            Live confirmation unavailable. The public Arc Mainnet RPC did not
            respond within the timeout. The certified cryptographic snapshot
            above remains fully authoritative.
          </p>
        </div>
      )}

      {state.kind === "MISMATCH" && (
        <div className="error" style={{ margin: "0.5rem 0" }}>
          <p role="alert" style={{ margin: 0 }}>
            Live Mainnet receipt does not match the certified snapshot
            coordinates.
          </p>
        </div>
      )}

      {state.kind === "CONFIRMED" && (
        <div className="stack" style={{ gap: "1rem" }}>
          <div
            style={{
              background: "var(--accent-verified-bg)",
              border: "1px solid var(--accent-verified-border)",
              borderRadius: "var(--radius-md)",
              padding: "0.85rem 1rem",
              fontSize: "0.875rem",
              color: "var(--accent-verified)",
              fontWeight: 550,
            }}
          >
            ✓ Confirmed onchain against Arc Mainnet node. Block and transaction
            hash match the certified manifest.
          </div>
          <dl>
            <dt>Chain ID</dt>
            <dd>5042 (0x13b2 / Arc Mainnet)</dd>
            <dt>Transaction</dt>
            <dd>
              <HashDisplay
                hash={state.receipt.transactionHash ?? transactionHash}
              />
            </dd>
            <dt>Confirmed block</dt>
            <dd>Block #{expectedBlockNumber}</dd>
            <dt>Block hash</dt>
            <dd>
              <HashDisplay
                hash={state.receipt.blockHash ?? expectedBlockHash}
              />
            </dd>
            <dt>Execution status</dt>
            <dd>
              <span className="badge badge-verified">Success (0x1)</span>
            </dd>
          </dl>
        </div>
      )}

      <p
        style={{
          marginTop: "1.25rem",
          marginBottom: 0,
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        This read-only check runs entirely in the browser and never requests a
        wallet, signature, or transaction.
      </p>
    </section>
  );
}

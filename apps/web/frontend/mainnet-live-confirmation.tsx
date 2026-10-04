"use client";

import { useEffect, useState } from "react";

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
      <h2 id="live-confirmation-heading">Live chain confirmation</h2>
      {state.kind === "LOADING" && <p role="status">Reading Arc Mainnet…</p>}
      {state.kind === "UNAVAILABLE" && (
        <p role="status">Live Mainnet state is currently unavailable.</p>
      )}
      {state.kind === "MISMATCH" && (
        <p role="alert" className="error">
          Live Mainnet receipt does not match the certified snapshot.
        </p>
      )}
      {state.kind === "CONFIRMED" && (
        <dl>
          <dt>Status</dt>
          <dd>Confirmed against Arc Mainnet</dd>
          <dt>Transaction</dt>
          <dd className="hash">{state.receipt.transactionHash}</dd>
          <dt>Block</dt>
          <dd>{expectedBlockNumber}</dd>
          <dt>Block hash</dt>
          <dd className="hash">{state.receipt.blockHash}</dd>
        </dl>
      )}
      <p>This read-only check never requests a wallet or transaction.</p>
    </section>
  );
}

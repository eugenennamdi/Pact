import type {
  ConfirmActionDto,
  PrepareActionDto,
  PublicWalletActionPath,
} from "../../../packages/product/src/public-contract";
import type { ProductNetworkConfig } from "../../../packages/product/src/network";
import type { ProductApiClient } from "./product-client";
import { PRODUCT_WALLET_NETWORK, type Eip1193Provider } from "./wallet";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function prepareActionForWallet(input: {
  readonly client: Pick<ProductApiClient, "prepareAction">;
  readonly slug: string;
  readonly action: PublicWalletActionPath;
  readonly idempotencyKey: string;
  readonly walletAddress: `0x${string}`;
  readonly walletChainId: number;
  readonly network?: ProductNetworkConfig;
}): Promise<PrepareActionDto> {
  const network = input.network ?? PRODUCT_WALLET_NETWORK;
  if (input.walletChainId !== network.chainIdNumber)
    throw new Error("WRONG_NETWORK");
  const prepared = await input.client.prepareAction(
    input.slug,
    input.action,
    input.idempotencyKey,
  );
  if (prepared.chainId !== network.chainIdNumber)
    throw new Error("PREPARE_WRONG_NETWORK");
  if (!sameAddress(prepared.requiredSigner, input.walletAddress))
    throw new Error("PREPARE_SIGNER_MISMATCH");
  return prepared;
}

function quantity(value: string): `0x${string}` {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("INVALID_TRANSACTION_VALUE");
  return `0x${BigInt(value).toString(16)}`;
}

export async function sendPreparedTransaction(input: {
  readonly provider: Eip1193Provider;
  readonly walletAddress: `0x${string}`;
  readonly prepared: PrepareActionDto;
  readonly network?: ProductNetworkConfig;
}): Promise<`0x${string}`> {
  const network = input.network ?? PRODUCT_WALLET_NETWORK;
  if (input.prepared.result !== "PREPARED")
    throw new Error("TRANSACTION_NOT_REQUIRED");
  if (input.prepared.chainId !== network.chainIdNumber)
    throw new Error("PREPARE_WRONG_NETWORK");
  if (!sameAddress(input.prepared.requiredSigner, input.walletAddress))
    throw new Error("PREPARE_SIGNER_MISMATCH");
  const transactionHash = await input.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.walletAddress,
        to: input.prepared.to,
        value: quantity(input.prepared.value),
        data: input.prepared.data,
      },
    ],
  });
  if (
    typeof transactionHash !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(transactionHash)
  ) {
    throw new Error("INVALID_TRANSACTION_HASH");
  }
  return transactionHash as `0x${string}`;
}

export async function confirmWalletTransaction(input: {
  readonly client: Pick<ProductApiClient, "confirmAction">;
  readonly slug: string;
  readonly action: PublicWalletActionPath;
  readonly transactionHash: `0x${string}`;
}): Promise<ConfirmActionDto> {
  return input.client.confirmAction(
    input.slug,
    input.action,
    input.transactionHash,
  );
}

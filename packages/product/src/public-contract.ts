import type { Challenge } from "./auth";
import type { PublicPactDto } from "./read-model";
import type { CreateDraftRequest, CreateDraftResponse } from "./service";
import type {
  ConfirmWalletActionResult,
  PrepareWalletActionResult,
  WalletActionPath,
} from "./wallet-lifecycle";

/**
 * Browser-safe public contract surface. This module intentionally exports
 * types only: client bundles must never import the aggregate product runtime.
 */
export type AuthChallengeDto = Challenge;

export interface AuthSessionDto {
  readonly walletAddress: `0x${string}`;
  readonly chainId: number;
  readonly expiresInSeconds: number;
}

export interface LogoutDto {
  readonly loggedOut: true;
}

export type CreatePactRequestDto = CreateDraftRequest;
export type CreatePactResponseDto = CreateDraftResponse;
export type PactDto = PublicPactDto;
export type EvidenceDto = NonNullable<PublicPactDto["evidence"]>;
export type SettlementDto = NonNullable<PublicPactDto["settlement"]>;
export type PrepareActionDto = PrepareWalletActionResult;
export type ConfirmActionDto = ConfirmWalletActionResult;
export type PublicWalletActionPath = WalletActionPath;

export interface RetryVerificationDto {
  readonly status: "QUEUED";
  readonly replayed: boolean;
}

export interface ProductApiErrorDto {
  readonly error: string;
}

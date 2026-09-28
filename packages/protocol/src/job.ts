import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const JOB_IDENTITY_SCHEMA_VERSION = 1 as const;

const JOB_IDENTITY_TYPE =
  "PactJobIdentity(uint8 schemaVersion,uint256 chainId,address commerceContract,uint256 jobId)";
const JOB_IDENTITY_TYPE_HASH = keccak256(stringToHex(JOB_IDENTITY_TYPE));
const UINT256_MAX = (1n << 256n) - 1n;

export interface PactJobIdentityInput {
  readonly chainId: bigint;
  readonly commerceContract: string;
  readonly jobId: bigint;
}

export interface CanonicalPactJobIdentity {
  readonly schemaVersion: typeof JOB_IDENTITY_SCHEMA_VERSION;
  readonly chainId: bigint;
  readonly commerceContract: Address;
  readonly jobId: bigint;
}

function assertUint256(label: string, value: bigint): void {
  if (value <= 0n || value > UINT256_MAX) {
    throw new Error(`${label} must be a positive uint256`);
  }
}

export function normalizePactJobIdentity(
  input: PactJobIdentityInput,
): CanonicalPactJobIdentity {
  assertUint256("chainId", input.chainId);
  assertUint256("jobId", input.jobId);

  if (!isAddress(input.commerceContract, { strict: true })) {
    throw new Error("commerceContract must be a valid EVM address");
  }

  const commerceContract = getAddress(input.commerceContract);
  if (commerceContract === "0x0000000000000000000000000000000000000000") {
    throw new Error("commerceContract must not be the zero address");
  }

  return Object.freeze({
    schemaVersion: JOB_IDENTITY_SCHEMA_VERSION,
    chainId: input.chainId,
    commerceContract,
    jobId: input.jobId,
  });
}

export function encodePactJobIdentity(identity: CanonicalPactJobIdentity): Hex {
  const canonical = normalizePactJobIdentity(identity);

  if (
    identity.schemaVersion !== JOB_IDENTITY_SCHEMA_VERSION ||
    identity.commerceContract !== canonical.commerceContract
  ) {
    throw new Error("job identity must already be in canonical version-1 form");
  }

  return encodeAbiParameters(
    parseAbiParameters(
      "bytes32 typeHash, uint8 schemaVersion, uint256 chainId, address commerceContract, uint256 jobId",
    ),
    [
      JOB_IDENTITY_TYPE_HASH,
      canonical.schemaVersion,
      canonical.chainId,
      canonical.commerceContract,
      canonical.jobId,
    ],
  );
}

export function hashPactJobIdentity(identity: CanonicalPactJobIdentity): Hex {
  return keccak256(encodePactJobIdentity(identity));
}

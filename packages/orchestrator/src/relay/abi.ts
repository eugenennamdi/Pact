export const pactCompletionAcceptedEvent = {
  type: "event",
  name: "PactCompletionAccepted",
  anonymous: false,
  inputs: [
    { name: "jobKey", type: "bytes32", indexed: true },
    { name: "jobId", type: "uint256", indexed: true },
    { name: "evidenceHash", type: "bytes32", indexed: true },
    { name: "conditionHash", type: "bytes32", indexed: false },
    { name: "attestationDigest", type: "bytes32", indexed: false },
    { name: "verifier", type: "address", indexed: false },
    { name: "relayer", type: "address", indexed: false },
  ],
} as const;

export const pactRelayAbi = [
  {
    type: "function",
    name: "bindCondition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "conditionHash", type: "bytes32" },
      { name: "completionDeadline", type: "uint64" },
      { name: "expectedVerifier", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "commerceContract",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "jobKey",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getBinding",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "exists", type: "bool" },
      {
        name: "binding",
        type: "tuple",
        components: [
          { name: "conditionHash", type: "bytes32" },
          { name: "completionDeadline", type: "uint64" },
          { name: "verifier", type: "address" },
          { name: "accepted", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isVerifierRevoked",
    stateMutability: "view",
    inputs: [{ name: "verifier", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "completeWithAttestation",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "commerceContract", type: "address" },
          { name: "jobId", type: "uint256" },
          { name: "conditionHash", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "satisfiedAt", type: "uint64" },
          { name: "verifiedAt", type: "uint64" },
          { name: "validUntil", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  pactCompletionAcceptedEvent,
] as const;

export const relayErc8183Abi = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "job",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "status", type: "uint8" },
          { name: "provider", type: "address" },
          { name: "expiredAt", type: "uint48" },
          { name: "evaluator", type: "address" },
          { name: "submittedAt", type: "uint48" },
          { name: "budget", type: "uint256" },
          { name: "hook", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "providerAgentId", type: "uint256" },
          { name: "description", type: "string" },
          { name: "settledAmount", type: "uint256" },
          { name: "payoutReceiver", type: "address" },
        ],
      },
    ],
  },
] as const;

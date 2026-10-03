export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const productErc8183Abi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint48" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
      { name: "providerAgentId", type: "uint256" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
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
  {
    type: "event",
    name: "JobCreated",
    anonymous: false,
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint48", indexed: false },
      { name: "hook", type: "address", indexed: false },
    ],
  },
] as const;

export const productEvaluatorAbi = [
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
] as const;

export const productUsdcAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

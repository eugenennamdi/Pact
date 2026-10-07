#!/usr/bin/env node
import {
  KernelVerificationError,
  runKernelVerification,
} from "./lib/certified-kernel.mjs";

if (process.argv.length !== 2) {
  console.error(
    "[certified-kernel] FAIL: command-line overrides are forbidden",
  );
  process.exit(2);
}

try {
  const result = await runKernelVerification();
  console.log(
    `[certified-kernel] PASS: ${result.currentProtectedFileCount} protected files (${result.historicalProtectedFileCount} baseline), ${result.dependencyPackageCount} dependency resolutions`,
  );
  console.log(JSON.stringify(result));
} catch (error) {
  const code =
    error instanceof KernelVerificationError
      ? error.code
      : "UNEXPECTED_VERIFICATION_FAILURE";
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof KernelVerificationError ? error.details : [];
  console.error(`[certified-kernel] FAIL ${code}: ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  console.log(JSON.stringify({ status: "FAIL", code, message, details }));
  process.exit(1);
}

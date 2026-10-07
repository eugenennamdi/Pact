export function resolveAnvilExecutable(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    environment.PACT_ANVIL_BIN?.trim() ||
    environment.ANVIL_BIN?.trim() ||
    "anvil"
  );
}

import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const address = reservation.address();
if (address === null || typeof address === "string")
  throw new Error("WEB_SMOKE_PORT_UNAVAILABLE");
const port = address.port;
reservation.close();
await once(reservation, "close");

const child = spawn("npm", ["run", "web:start"], {
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output = `${output}${String(chunk)}`.slice(-4_000);
});
child.stderr.on("data", (chunk) => {
  output = `${output}${String(chunk)}`.slice(-4_000);
});

try {
  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (response === undefined)
    throw new Error(`WEB_START_SMOKE_FAILED: ${output}`);
  const body = await response.json();
  if (
    (response.status !== 200 && response.status !== 503) ||
    (body.status !== "ready" && body.status !== "not_ready")
  ) {
    throw new Error("WEB_HEALTH_SMOKE_INVALID_RESPONSE");
  }
  process.stdout.write(
    `Web production start smoke: PASS (PORT=${port}, status=${response.status})\n`,
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

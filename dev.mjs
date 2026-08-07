#!/usr/bin/env node
/**
 * Runs apps/web (Next.js) and apps/agent (uvicorn) together, interleaving their
 * output with a per-process prefix. No dependencies — node:child_process only.
 *
 *   npm run dev
 *   WEB_PORT=3001 AGENT_PORT=8023 npm run dev
 *
 * The web app is told where the agent is via AGENT_ENDPOINT, which Next reads
 * ahead of apps/web/.env.local (Next never overwrites an inherited env var), so
 * AGENT_PORT alone is enough to move both halves.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname;
const win = process.platform === "win32";
const colour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `\x1b[${code}m${text}\x1b[0m` : text);

const WEB_PORT = process.env.WEB_PORT || "3000";
const AGENT_PORT = process.env.AGENT_PORT || "8000";

// Windows puts the venv interpreter in Scripts/, macOS and Linux in bin/.
const python = ["Scripts/python.exe", "bin/python", "bin/python3"]
  .map((rel) => join(root, "apps", "agent", ".venv", rel))
  .find(existsSync);

if (!python) {
  console.error(
    "No virtualenv found at apps/agent/.venv — run the agent setup in README.md first.",
  );
  process.exit(1);
}

// A port already in use kills uvicorn with "[WinError 10013] An attempt was made
// to access a socket in a way forbidden by its access permissions", which names
// neither the port nor the process - and then this runner stops the other half,
// so it reads as the whole thing refusing to start. One line naming the owner
// saves the twenty minutes that costs. Read-only: reclaiming the port is the
// operator's call, since it might not be theirs to kill.
for (const [name, port] of [
  ["web", WEB_PORT],
  ["agent", AGENT_PORT],
]) {
  const owner = win
    ? execFileSync("netstat", ["-ano"], { encoding: "utf8" })
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find((c) => c[3] === "LISTENING" && c[1]?.endsWith(`:${port}`))?.[4]
    : null;
  if (!owner) continue;
  console.error(
    `Port ${port} (${name}) is already in use by process ${owner}.\n` +
      `Stop it with:  taskkill /pid ${owner} /t /f\n` +
      "Or move both:  WEB_PORT=3001 AGENT_PORT=8001 npm run dev",
  );
  process.exit(1);
}

const specs = [
  {
    name: "web",
    colour: 36, // cyan
    // npm is npm.cmd on Windows, and since Node 20.12 spawning a .cmd without a
    // shell throws EINVAL — hence both of these. The args are all literals, so
    // there is nothing for cmd.exe to mis-quote.
    cmd: win ? "npm.cmd" : "npm",
    shell: win,
    args: ["run", "dev", "--", "--port", WEB_PORT],
    cwd: join(root, "apps", "web"),
    env: {
      // 127.0.0.1, not localhost. uvicorn binds IPv4 loopback only, and Node
      // resolves localhost to ::1 first on Windows - which fails to connect
      // against a server that is running perfectly well.
      AGENT_ENDPOINT: process.env.AGENT_ENDPOINT || `http://127.0.0.1:${AGENT_PORT}`,
    },
  },
  {
    name: "agent",
    colour: 35, // magenta
    cmd: python,
    // --reload-dir app, not a bare --reload. Bare --reload watches the whole
    // working directory, which here means .venv and build/ - tens of thousands
    // of files to stat on every poll. It makes startup slow, burns CPU idling,
    // and restarts the agent when nothing you wrote has changed.
    args: [
      "-m",
      "uvicorn",
      "app.main:app",
      "--reload",
      "--reload-dir",
      "app",
      "--port",
      AGENT_PORT,
    ],
    cwd: join(root, "apps", "agent"),
    env: { PYTHONUNBUFFERED: "1" },
  },
];

const width = Math.max(...specs.map((s) => s.name.length));
const write = (spec, text) =>
  process.stdout.write(`${paint(spec.colour, `[${spec.name.padEnd(width)}]`)} ${text}\n`);

/** Emit whole lines only, so two chatty processes never split each other mid-line. */
function prefix(spec, stream) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) write(spec, line);
  });
  stream.on("end", () => {
    if (rest) write(spec, rest);
  });
}

const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      // Both children spawn their own children (Next workers, the uvicorn
      // reloader), so kill the tree rather than just the process we hold.
      if (win) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone. Nothing to do.
    }
  }
  // Deliberately not "kill whatever holds our port": if this runner is exiting
  // *because* the port was already taken, that would kill someone else's server
  // to clean up after ourselves.
  //
  // Backstop for a child that ignores the signal. Unref'd so a clean exit is
  // still immediate.
  setTimeout(() => process.exit(code), 5000).unref();
}

for (const spec of specs) {
  const child = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: Boolean(spec.shell),
    // POSIX: own process group, so process.kill(-pid) reaches the whole tree.
    // Windows has no groups here; taskkill /t does the same job.
    detached: !win,
  });

  child.on("error", (error) => {
    write(spec, `failed to start (${spec.cmd}): ${error.message}`);
    stop(1);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    write(spec, `exited with ${signal ? `signal ${signal}` : `code ${code}`}. Stopping the other process.`);
    stop(code ?? 1);
  });

  prefix(spec, child.stdout);
  prefix(spec, child.stderr);
  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

console.log(
  `web    -> http://localhost:${WEB_PORT}\n` +
    `agent  -> http://localhost:${AGENT_PORT}   (Ctrl+C stops both)\n` +
    // Named because a bare `uvicorn` on PATH is usually a different Python, and
    // that shows up as an SSL error about a missing file rather than as anything
    // mentioning interpreters. Seeing the path rules it out in one glance.
    `python -> ${python}\n`,
);

// Which backends are actually live, read off the running process once it
// answers. Reading .env.local and hoping is how a run against a stale server
// serving fakes gets mistaken for a real one.
(async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !stopping) {
    try {
      // 127.0.0.1 for the same reason as AGENT_ENDPOINT above.
      const response = await fetch(`http://127.0.0.1:${AGENT_PORT}/health`);
      if (response.ok) {
        const health = await response.json();
        const live = health.sap === "McpSap" && health.judge === "BedrockJudge";
        console.log(
          `${paint(live ? 32 : 33, live ? "live " : "fakes")} sap=${health.sap} judge=${health.judge}\n`,
        );
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
})();

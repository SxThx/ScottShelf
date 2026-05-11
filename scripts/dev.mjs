import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm" : "npm";

const processes = [
  ["api", ["--prefix", "backend", "run", "dev"]],
  ["web", ["--prefix", "frontend", "run", "dev"]]
];

const children = [];
let shuttingDown = false;

for (const [name, args] of processes) {
  const child = spawn(npmCommand, args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: isWindows
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (signal) {
      shutdown(signal);
      return;
    }
    if (code && code !== 0) {
      shutdown();
      process.exitCode = code;
    }
  });

  children.push(child);
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal || "SIGTERM");
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

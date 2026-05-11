import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const mode = process.argv[2];
const tempDir = process.platform === "win32" ? os.tmpdir() : "/tmp";
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(backendRoot, "..");
const inheritedEnvKeys = new Set(Object.keys(process.env));

function loadEnvFile(filePath, targetEnv) {
  if (!fs.existsSync(filePath)) return;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!inheritedEnvKeys.has(key)) targetEnv[key] = value;
  }
}

const env = {
  ...process.env,
  TMPDIR: tempDir,
  TEMP: tempDir,
  TMP: tempDir
};

loadEnvFile(path.join(projectRoot, ".env"), env);
loadEnvFile(path.join(backendRoot, ".env"), env);

if (mode === "production") {
  env.NODE_ENV = "production";
}

const child = spawn(process.execPath, [path.join(backendRoot, "node_modules/tsx/dist/cli.mjs"), path.join(backendRoot, "src/index.ts")], {
  env,
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

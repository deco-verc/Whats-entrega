// .agents/hooks/stop-typecheck-gate.cjs
// Gates agent termination on clean TypeScript compilation (up to 3 retries).

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  const retryFile = path.join(projectRoot, ".ai-dev-hub", ".stop_hook_retries");

  if (!fs.existsSync(tsconfigPath)) {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
    return;
  }

  let retries = 0;
  if (fs.existsSync(retryFile)) {
    try {
      retries = parseInt(fs.readFileSync(retryFile, "utf-8").trim(), 10) || 0;
    } catch (_e) {
      retries = 0;
    }
  }

  try {
    execSync("npx tsc --noEmit", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25000,
      shell: true
    });

    try {
      if (fs.existsSync(retryFile)) {
        fs.unlinkSync(retryFile);
      }
    } catch (_e) {}

    process.stdout.write(JSON.stringify({ decision: "allow" }));
  } catch (err) {
    if (retries < 3) {
      const nextRetries = retries + 1;
      try {
        fs.mkdirSync(path.dirname(retryFile), { recursive: true });
        fs.writeFileSync(retryFile, String(nextRetries), "utf-8");
      } catch (_e) {}

      const outputSummary = (err.stdout || err.stderr || err.message || "").toString().slice(0, 1000);
      process.stdout.write(JSON.stringify({
        decision: "continue",
        reason: `DecoHUB Typecheck Gate: TypeScript compilation failed (${nextRetries}/3). Fix compilation errors:\n${outputSummary}`
      }));
    } else {
      try {
        if (fs.existsSync(retryFile)) {
          fs.unlinkSync(retryFile);
        }
      } catch (_e) {}
      process.stdout.write(JSON.stringify({ decision: "allow" }));
    }
  }
});
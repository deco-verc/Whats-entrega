// .agents/hooks/pre-tool-ownership-guard.cjs
// Guards protected environment files and explicitly allows all other tool executions.

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    const toolCall = payload.toolCall || {};
    const argsString = JSON.stringify(toolCall.args || {}).toLowerCase();

    if (argsString.includes(".env.production")) {
      process.stdout.write(JSON.stringify({
        decision: "deny",
        reason: "DecoHUB Security Guard: Direct modifications to .env.production are strictly blocked."
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ decision: "allow" }));
  } catch (_err) {
    process.stdout.write(JSON.stringify({ decision: "allow" }));
  }
});
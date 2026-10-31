// .agents/hooks/pre-invocation-reminder.cjs
// Emits ephemeral reminders to reinforce Fable engineering invariants.

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const payload = {
    injectSteps: [
      {
        ephemeralMessage: "[DecoHUB Invariant Reminder] Fable autonomous execution active: zero emojis, parameterized SQLite queries, PORT 4000-4999, GET / exclusively serves HTML, verified via tsc --noEmit."
      }
    ]
  };
  process.stdout.write(JSON.stringify(payload));
});
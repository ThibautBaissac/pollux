export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as Record<string, unknown>;
  if (g.__polluxDreamStarted) return;
  g.__polluxDreamStarted = true;

  const start = async () => {
    const { initMemoryGit } = await import("./lib/git-memory");
    const { runDream } = await import("./lib/dream");
    const { dream } = await import("./lib/dream-config");

    initMemoryGit();

    const schedule = () => {
      setTimeout(async () => {
        try {
          await runDream();
        } catch (err) {
          console.error("Dream failed:", err);
        }
        schedule();
      }, dream.intervalMs);
    };

    // Run once shortly after startup, then self-schedule
    setTimeout(async () => {
      try {
        await runDream();
      } catch (err) {
        console.error("Dream failed:", err);
      }
      schedule();
    }, dream.startupDelayMs);
  };

  start().catch((err) => console.error("Dream scheduler init failed:", err));
}

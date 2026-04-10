const REMINDER_CHECK_INTERVAL_MS = 60_000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as Record<string, unknown>;

  // --- Dream scheduler ---
  if (!g.__polluxDreamStarted) {
    g.__polluxDreamStarted = true;

    const startDream = async () => {
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

    startDream().catch((err) =>
      console.error("Dream scheduler init failed:", err),
    );
  }

  // --- Reminder scheduler ---
  if (!g.__polluxRemindersStarted) {
    g.__polluxRemindersStarted = true;

    const startReminders = async () => {
      const { checkDueReminders } = await import("./lib/reminders");

      const tick = () => {
        setTimeout(() => {
          try {
            checkDueReminders();
          } catch (err) {
            console.error("Reminder check failed:", err);
          }
          tick();
        }, REMINDER_CHECK_INTERVAL_MS);
      };

      // First check shortly after startup, then self-schedule
      setTimeout(() => {
        try {
          checkDueReminders();
        } catch (err) {
          console.error("Reminder check failed:", err);
        }
        tick();
      }, 5_000);
    };

    startReminders().catch((err) =>
      console.error("Reminder scheduler init failed:", err),
    );
  }
}

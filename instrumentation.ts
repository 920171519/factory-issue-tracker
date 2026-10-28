export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startHandoffScheduler } = await import("./lib/scheduler");
    startHandoffScheduler();
  }
}

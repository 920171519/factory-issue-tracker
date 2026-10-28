import { runShiftHandoff } from "@/lib/handoff";

type SchedulerState = { timer?: NodeJS.Timeout; started?: boolean };
const globalKey = "__factoryIssueTrackerScheduler";

function state(): SchedulerState {
  const scope = globalThis as typeof globalThis & { [globalKey]?: SchedulerState };
  if (!scope[globalKey]) scope[globalKey] = {};
  return scope[globalKey];
}

export function startHandoffScheduler(): void {
  const current = state();
  if (current.started) return;
  current.started = true;
  const enabled = process.env.ENABLE_SCHEDULER === "true";
  if (!enabled) {
    console.info("[scheduler] ENABLE_SCHEDULER 未开启，跳过内置交班调度器");
    return;
  }
  console.info("[scheduler] 内置交班调度器已启动（每 60 秒检查一次，单实例部署）");
  const tick = () => {
    try {
      const result = runShiftHandoff(new Date());
      if (result.handedOffGroups > 0 || result.errors.length > 0) {
        console.info("[scheduler] handoff", JSON.stringify(result));
      }
    } catch (error) {
      console.error("[scheduler] handoff failed", error);
    }
  };
  const initial = setTimeout(tick, 5_000);
  initial.unref();
  current.timer = setInterval(tick, 60_000);
  current.timer.unref();
}

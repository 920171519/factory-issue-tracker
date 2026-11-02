import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticate, registerAccount } from "@/lib/auth";
import { makeTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeEach(() => { env = makeTestEnv(); });
afterEach(() => { env.cleanup(); });

describe("注册工号不再限制固定格式", () => {
  it("支持字母、数字、-、_、. 等不同类型的工号，并可用注册工号登录", async () => {
    const employeeNos = ["A001", "xh-2026_001", "20260001", "eng.zhang", "XH/2026/001"];
    for (const employeeNo of employeeNos) {
      const user = await registerAccount({ name: "测试用户", employeeNo, password: "Demo1234" });
      expect(user.employeeNo).toBe(employeeNo);
      const logged = await authenticate(employeeNo, "Demo1234");
      expect(logged.id).toBe(user.id);
    }
  });

  it("工号保留原始大小写，登录需完全匹配", async () => {
    const user = await registerAccount({ name: "大小写用户", employeeNo: "AbC-001", password: "Demo1234" });
    expect(user.employeeNo).toBe("AbC-001");
    await expect(authenticate("abc-001", "Demo1234")).rejects.toThrow();
  });

  it("空工号、含空格工号与超长工号被拒绝", async () => {
    await expect(registerAccount({ name: "测试", employeeNo: "   ", password: "Demo1234" })).rejects.toThrow(/工号/);
    await expect(registerAccount({ name: "测试", employeeNo: "A 001", password: "Demo1234" })).rejects.toThrow(/空格/);
    await expect(registerAccount({ name: "测试", employeeNo: "X".repeat(41), password: "Demo1234" })).rejects.toThrow(/40/);
  });

  it("同一工号不能重复注册", async () => {
    await registerAccount({ name: "测试", employeeNo: "A001", password: "Demo1234" });
    await expect(registerAccount({ name: "测试2", employeeNo: "A001", password: "Demo1234" })).rejects.toThrow(/已注册/);
  });
});

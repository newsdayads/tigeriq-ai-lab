// tests/api_doctor.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiDoctor } from "../apps/tigeriq-core/api_doctor.mjs";

// Mock telemetry
vi.mock("../apps/tigeriq-core/telemetry.js", () => ({
  emitEvent: vi.fn()
}));
import { emitEvent } from "../apps/tigeriq-core/telemetry.js";

// Mock durable store
class MockStore {
  constructor() { this.put = vi.fn(); }
}
vi.mock("../../packages/durable-control-plane/index.js", () => ({
  DurableStore: MockStore
}));

// Helper to create a fetch stub that resolves sequentially
function createFetchStub(responses) {
  let call = 0;
  return vi.fn(() => {
    const resp = responses[call++] ?? responses[responses.length - 1];
    if (resp instanceof Error) return Promise.reject(resp);
    return Promise.resolve({
      status: resp.status,
      ok: resp.status >= 200 && resp.status < 300,
      json: async () => ({})
    });
  });
}

describe("ApiDoctor", () => {
  const nv10 = "https://nv10.example/health";
  const poll = ["https://nv11.example/health"];
  let doctor;

  beforeEach(() => {
    vi.useFakeTimers();
    emitEvent.mockReset();
  });

  afterEach(() => {
    if (doctor) doctor.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("records healthy state on 200 response", async () => {
    global.fetch = createFetchStub([{ status: 200 }]);
    doctor = new ApiDoctor({ nv10Endpoint: nv10, pollEndpoints: poll, interval: 1000 });
    doctor.start();
    await vi.runAllTimersAsync();
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_state_change", expect.objectContaining({ to: "healthy" }));
  });

  it("enters cooldown on 429 and re‑probes after timeout", async () => {
    global.fetch = createFetchStub([
      { status: 429 }, // first poll triggers cooldown
      { status: 200 }  // after cooldown expires
    ]);
    doctor = new ApiDoctor({ nv10Endpoint: nv10, pollEndpoints: poll, interval: 1000 });
    doctor.start();
    await vi.runAllTimersAsync(); // first poll
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_state_change", expect.objectContaining({ to: "cooldown" }));
    // fast‑forward 60s cooldown
    vi.advanceTimersByTime(60_000);
    await vi.runAllTimersAsync();
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_state_change", expect.objectContaining({ to: "healthy" }));
  });

  it("handles HTTP 402 as blocked without retry", async () => {
    global.fetch = createFetchStub([{ status: 402 }]);
    doctor = new ApiDoctor({ nv10Endpoint: nv10, pollEndpoints: poll, interval: 1000 });
    doctor.start();
    await vi.runAllTimersAsync();
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_state_change", expect.objectContaining({ to: "blocked" }));
    // ensure no retry events were emitted
    const retryCalls = emitEvent.mock.calls.filter(c => c[0] === "api_doctor_retry");
    expect(retryCalls).toHaveLength(0);
  });

  it("retries on transient 500 errors with exponential back‑off", async () => {
    global.fetch = createFetchStub([
      { status: 500 }, // first attempt – triggers retry
      { status: 500 }, // second attempt
      { status: 200 }  // third attempt succeeds
    ]);
    doctor = new ApiDoctor({ nv10Endpoint: nv10, pollEndpoints: poll, interval: 1000 });
    doctor.start();
    // first poll triggers retry logic – we need to advance timers for back‑off delays
    await vi.runAllTimersAsync(); // run immediate poll
    // first back‑off (500ms)
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    // second back‑off (1000ms)
    vi.advanceTimersByTime(1_000);
    await vi.runAllTimersAsync();
    // final successful poll
    await vi.runAllTimersAsync();
    const stateCalls = emitEvent.mock.calls.filter(c => c[0] === "api_doctor_state_change");
    const finalState = stateCalls[stateCalls.length - 1][1].to;
    expect(finalState).toBe("healthy");
  });

  it("records a durable hand‑off after max retries and triggers repair", async () => {
    global.fetch = createFetchStub([
      { status: 500 }, // 1st
      { status: 500 }, // 2nd
      { status: 500 }, // 3rd – exceeds maxRetries
      { status: 200 }  // NV10 probe after repair
    ]);
    doctor = new ApiDoctor({ nv10Endpoint: nv10, pollEndpoints: poll, interval: 1000 });
    doctor.start();
    // run through retries (500ms, 1000ms, 2000ms)
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(1_000);
    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(2_000);
    await vi.runAllTimersAsync();
    // after max retries, hand‑off should be recorded and repair triggered
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_handoff_recorded", expect.any(Object));
    expect(emitEvent).toHaveBeenCalledWith("api_doctor_repair_triggered", expect.any(Object));
    // final NV10 probe returns 200 → recovered state
    const recovered = emitEvent.mock.calls.find(c => c[0] === "api_doctor_recovered");
    expect(recovered).toBeDefined();
  });
});

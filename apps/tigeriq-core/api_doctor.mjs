// apps/tigeriq-core/api_doctor.mjs
import { emitEvent } from "./telemetry.js";
import { DurableStore } from "../../packages/durable-control-plane/index.js";

export class ApiDoctor {
  /**
   * @param {Object} options
   * @param {string} options.nv10Endpoint - base URL for NV10 (Ollama) endpoint
   * @param {Array<string>} options.pollEndpoints - list of health/event URLs (NV11‑NV20)
   * @param {number} [options.interval=30000] - polling interval in ms
   */
  constructor({ nv10Endpoint, pollEndpoints, interval = 30000 }) {
    this.nv10Endpoint = nv10Endpoint;
    this.pollEndpoints = pollEndpoints;
    this.interval = interval;

    this._timer = null; // main polling interval
    this._cooldown = null; // cooldown timeout handle
    this._retryCount = 0;
    this._maxRetries = 3;
    this._backoffBase = 500; // ms base for exponential back‑off
    this._state = "unknown";
    this._store = new DurableStore("api_doctor");
  }

  /** Start periodic polling */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._pollAll(), this.interval);
    this._pollAll(); // immediate first run
    emitEvent("api_doctor_started", { endpoint: this.nv10Endpoint });
  }

  /** Stop all timers */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._cooldown) {
      clearTimeout(this._cooldown);
      this._cooldown = null;
    }
    emitEvent("api_doctor_stopped", { endpoint: this.nv10Endpoint });
  }

  /** Poll every configured health endpoint */
  async _pollAll() {
    if (this._cooldown) return; // respect cooldown state
    for (const url of this.pollEndpoints) {
      try {
        const res = await fetch(url);
        await this._handleResponse(res, url);
      } catch (err) {
        await this._handleTransientError(err, url);
      }
    }
  }

  /** Process HTTP response */
  async _handleResponse(res, url) {
    if (res.status === 200) {
      this._setState("healthy");
      this._retryCount = 0;
      return;
    }
    if (res.status === 429) {
      this._setState("cooldown");
      this._scheduleCooldown();
      return;
    }
    if (res.status === 402) {
      this._setState("blocked");
      emitEvent("api_doctor_blocked", { url, status: 402 });
      return;
    }
    if (res.status >= 500 && res.status < 600) {
      await this._handleTransientError(new Error(`HTTP ${res.status}`), url);
      return;
    }
    // Any other non‑200 status is treated as unhealthy but not retryable
    this._setState("unhealthy");
  }

  /** Handle transient failures with bounded exponential back‑off */
  async _handleTransientError(err, url) {
    if (this._retryCount >= this._maxRetries) {
      await this._recordHandoff(url, err);
      this._setState("repaired");
      await this._triggerRepair();
      return;
    }
    const delay = this._backoffBase * 2 ** this._retryCount;
    this._retryCount++;
    this._setState("retry");
    emitEvent("api_doctor_retry", { url, attempt: this._retryCount, delay });
    await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(url);
      await this._handleResponse(res, url);
    } catch (e) {
      await this._handleTransientError(e, url);
    }
  }

  /** Schedule a deterministic cooldown after a 429 */
  _scheduleCooldown() {
    const cooldownMs = 60_000; // 1 minute
    if (this._cooldown) clearTimeout(this._cooldown);
    this._cooldown = setTimeout(() => {
      this._cooldown = null;
      emitEvent("api_doctor_cooldown_expired", { endpoint: this.nv10Endpoint });
      this._pollAll(); // re‑probe after cooldown
    }, cooldownMs);
  }

  /** Persist a deduped hand‑off entry for later repair */
  async _recordHandoff(url, err) {
    const key = `${url}:${Date.now()}`;
    await this._store.put(key, {
      url,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
    emitEvent("api_doctor_handoff_recorded", { key });
  }

  /** Trigger a repair workflow (placeholder) */
  async _triggerRepair() {
    emitEvent("api_doctor_repair_triggered", { endpoint: this.nv10Endpoint });
    // Simulate async repair work – in production this would start a real workflow
    await new Promise((r) => setTimeout(r, 100));
    await this._probeNv10();
  }

  /** Probe the NV10 endpoint after a repair */
  async _probeNv10() {
    try {
      const res = await fetch(this.nv10Endpoint);
      if (res.ok) {
        this._setState("recovered");
        emitEvent("api_doctor_recovered", { endpoint: this.nv10Endpoint });
      } else {
        this._setState("repaired");
      }
    } catch (_) {
      this._setState("repaired");
    }
  }

  /** Emit state‑change telemetry only on actual changes */
  _setState(newState) {
    if (this._state !== newState) {
      const prev = this._state;
      this._state = newState;
      emitEvent("api_doctor_state_change", { from: prev, to: newState });
    }
  }
}

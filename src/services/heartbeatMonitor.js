const { ROLE_PASSENGER, ROLE_CAB_DEVICE } = require('../constants/roles');

const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 10000;

class HeartbeatMonitor {
  constructor() {
    this.entries = new Map();
    this.interval = null;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  _key(rideId, role) {
    return `${rideId}:${role}`;
  }

  register(rideId, role, onTimeout) {
    if (role !== ROLE_PASSENGER && role !== ROLE_CAB_DEVICE) return;
    const key = this._key(rideId, role);
    this.entries.set(key, {
      rideId,
      role,
      lastBeatAt: Date.now(),
      onTimeout,
      timeoutTriggered: false
    });
  }

  update(rideId, role) {
    const key = this._key(rideId, role);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.lastBeatAt = Date.now();
    entry.timeoutTriggered = false;
  }

  unregister(rideId, role) {
    const key = this._key(rideId, role);
    this.entries.delete(key);
  }

  checkHeartbeats() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.timeoutTriggered) continue;
      if (now - entry.lastBeatAt > HEARTBEAT_TIMEOUT_MS) {
        entry.timeoutTriggered = true;
        try {
          entry.onTimeout(entry.rideId, entry.role);
        } catch (err) {
          console.error('Heartbeat timeout handler error:', err);
        }
      }
    }
  }
}

const heartbeatMonitor = new HeartbeatMonitor();
heartbeatMonitor.start();

module.exports = heartbeatMonitor;

#!/usr/bin/env node

// Simple cab device simulator:
// - Fetches a CAB_DEVICE JWT from /auth/token
// - Opens a ws:// connection to the backend
// - Sends REGISTER, heartbeat every 5s, and location updates every 7s
// - Can optionally send HARASSMENT_DETECTED and SOS_RAISED events

const WebSocket = require('ws');
const http = require('http');
const https = require('https');

const BACKEND_URL = process.env.BACKEND_URL || 'https://exchosafebe.onrender.com';

function log(msg, obj) {
  const ts = new Date().toISOString();
  if (obj) {
    console.log(`[${ts}] ${msg}`, obj);
  } else {
    console.log(`[${ts}] ${msg}`);
  }
}

function httpPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${bodyStr}`));
        }
        try {
          const json = JSON.parse(bodyStr);
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const rideId = process.argv[2] || 'ride123';
  const cabDeviceId = process.argv[3] || 'cab-device-1';

  log(`Starting cab device simulator for rideId=${rideId}, cabDeviceId=${cabDeviceId}`);

  const tokenRes = await httpPostJson(`${BACKEND_URL}/auth/token`, {
    userId: cabDeviceId,
    role: 'CAB_DEVICE'
  });
  const token = tokenRes.token;
  if (!token) {
    throw new Error('No token returned from /auth/token');
  }
  log('Obtained JWT token');

  const wsUrl = BACKEND_URL.replace(/^http/, 'ws');
  const ws = new WebSocket(wsUrl);

  let heartbeatTimer = null;
  let locationTimer = null;

  function startLoops() {
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
        log('HEARTBEAT sent');
      }, 5000);
    }
    if (!locationTimer) {
      locationTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Simple random walk around some base coordinates
        const baseLat = 12.9716;
        const baseLng = 77.5946;
        const jitterLat = (Math.random() - 0.5) * 0.01;
        const jitterLng = (Math.random() - 0.5) * 0.01;
        const payload = { lat: baseLat + jitterLat, lng: baseLng + jitterLng };
        ws.send(JSON.stringify({ type: 'LOCATION_UPDATE', payload }));
        log('LOCATION_UPDATE sent', payload);
      }, 7000);
    }
  }

  function stopLoops() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (locationTimer) {
      clearInterval(locationTimer);
      locationTimer = null;
    }
  }

  ws.on('open', () => {
    log('WebSocket connected, sending REGISTER');
    ws.send(
      JSON.stringify({
        type: 'REGISTER',
        payload: {
          role: 'CAB_DEVICE',
          rideId,
          token
        }
      })
    );
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'REGISTERED') {
        log('REGISTERED by backend', msg.payload);
        startLoops();
      } else if (msg.type === 'ERROR') {
        log(`SERVER ERROR: ${msg.payload.message || 'Unknown'}`, msg.payload);
      } else {
        log(`SERVER EVENT: ${msg.type}`, msg.payload);
      }
    } catch (err) {
      log('Failed to parse server message', { raw: data.toString() });
    }
  });

  ws.on('close', () => {
    log('WebSocket closed');
    stopLoops();
  });

  ws.on('error', (err) => {
    log('WebSocket error', { error: err.message });
  });

  // Optional: listen for stdin commands to send events
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    const cmd = chunk.trim().toLowerCase();
    if (!cmd) return;
    if (cmd === 'sos') {
      ws.send(JSON.stringify({ type: 'SOS_RAISED' }));
      log('Manual SOS_RAISED sent');
    } else if (cmd === 'harass') {
      ws.send(
        JSON.stringify({
          type: 'HARASSMENT_DETECTED',
          payload: { confidence: 0.95 }
        })
      );
      log('HARASSMENT_DETECTED sent');
    } else if (cmd === 'quit' || cmd === 'exit') {
      log('Exiting on user command');
      stopLoops();
      ws.close();
      process.exit(0);
    } else {
      log(`Unknown command "${cmd}". Available: sos | harass | quit`);
    }
  });
}

main().catch((err) => {
  log('Fatal error', { error: err.message });
  process.exit(1);
});


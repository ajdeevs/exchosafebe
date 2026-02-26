(() => {
  const logEl = document.getElementById('log');
  const rideListEl = document.getElementById('ride-list');
  const wsStatusEl = document.getElementById('ws-status');
  const wsEndpointEl = document.getElementById('ws-endpoint');
  const statActiveRidesEl = document.getElementById('stat-active-rides');
  const statOpenSosEl = document.getElementById('stat-open-sos');
  const statMediaEl = document.getElementById('stat-media');
  const footerTimeEl = document.getElementById('footer-time');
  const mapMetaEl = document.getElementById('map-meta');

  let map;
  let mapReady = false;
  let sosMarker;
  let sosFocusRideId = null;

  const rides = new Map();
  let mediaCount = 0;

  function fmtTime(d) {
    return d.toLocaleTimeString(undefined, { hour12: false });
  }

  function updateFooterClock() {
    const now = new Date();
    footerTimeEl.textContent = `Local time ${fmtTime(now)}`;
  }

  setInterval(updateFooterClock, 1000);
  updateFooterClock();

  function appendLog(tag, kind, text, extra) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = document.createElement('time');
    time.textContent = `[${fmtTime(new Date())}] `;
    const tagSpan = document.createElement('span');
    tagSpan.className = `tag ${kind}`;
    tagSpan.textContent = tag;
    const body = document.createElement('span');
    const extraText = extra ? ` ${JSON.stringify(extra)}` : '';
    body.textContent = ` ${text}${extraText}`;
    line.appendChild(time);
    line.appendChild(tagSpan);
    line.appendChild(body);
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function recomputeStats() {
    let activeRides = 0;
    let openSos = 0;
    rides.forEach((r) => {
      if (r.lastLocation) {
        activeRides += 1;
      }
      if (r.sosCount > 0) {
        openSos += 1;
      }
    });
    statActiveRidesEl.textContent = String(activeRides);
    statOpenSosEl.textContent = String(openSos);
    statMediaEl.textContent = String(mediaCount);
  }

  function renderRides() {
    rideListEl.innerHTML = '';
    const sorted = Array.from(rides.values()).sort((a, b) => {
      return (b.lastUpdated || 0) - (a.lastUpdated || 0);
    });
    sorted.forEach((ride) => {
      const item = document.createElement('div');
      item.className = 'ride-item';
      if (ride.sosCount > 0) {
        item.classList.add('active');
      }
      const header = document.createElement('div');
      header.className = 'ride-header';
      const idSpan = document.createElement('div');
      idSpan.className = 'ride-id';
      idSpan.textContent = ride.rideId;
      const statusSpan = document.createElement('div');
      const statusLabel = document.createElement('span');
      if (ride.sosCount > 0) {
        statusLabel.className = 'ride-status status-sos';
        statusLabel.textContent = `SOS ×${ride.sosCount}`;
      } else if (ride.harassmentCount > 0) {
        statusLabel.className = 'ride-status status-flagged';
        statusLabel.textContent = `FLAGGED ×${ride.harassmentCount}`;
      } else if (ride.lastLocation) {
        statusLabel.className = 'ride-status status-active';
        statusLabel.textContent = 'ACTIVE';
      } else {
        statusLabel.className = 'ride-status';
        statusLabel.textContent = 'IDLE';
      }
      statusSpan.appendChild(statusLabel);
      header.appendChild(idSpan);
      header.appendChild(statusSpan);

      const meta = document.createElement('div');
      meta.className = 'ride-meta';
      if (ride.lastLocation) {
        const loc = document.createElement('span');
        loc.textContent = `loc ${ride.lastLocation.lat.toFixed(4)}, ${ride.lastLocation.lng.toFixed(4)} (${ride.lastLocationRole})`;
        meta.appendChild(loc);
      }
      if (ride.mediaCount > 0) {
        const media = document.createElement('span');
        media.textContent = `media ×${ride.mediaCount}`;
        meta.appendChild(media);
      }
      if (ride.lastUpdated) {
        const t = document.createElement('span');
        t.textContent = `updated ${fmtTime(new Date(ride.lastUpdated))}`;
        meta.appendChild(t);
      }

      item.appendChild(header);
      item.appendChild(meta);
      rideListEl.appendChild(item);
    });
  }

  function ensureRide(rideId) {
    if (!rides.has(rideId)) {
      rides.set(rideId, {
        rideId,
        lastLocation: null,
        lastLocationRole: null,
        sosCount: 0,
        harassmentCount: 0,
        mediaCount: 0,
        lastUpdated: 0
      });
    }
    return rides.get(rideId);
  }

  function initMap() {
    if (mapReady || typeof L === 'undefined') return;
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView([20.5937, 78.9629], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    mapReady = true;
  }

  function updateSosMarker(ride) {
    if (!mapReady || !ride || !ride.lastLocation) return;
    const { lat, lng } = ride.lastLocation;
    const latLng = [lat, lng];

    if (!sosMarker) {
      const icon = L.divIcon({
        className: 'sos-marker',
        html: '<div class="sos-pulse"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      sosMarker = L.marker(latLng, { icon }).addTo(map);
    } else {
      sosMarker.setLatLng(latLng);
    }
    map.setView(latLng, 13, { animate: true });
    mapMetaEl.textContent = `Tracking ride ${ride.rideId}`;
  }

  async function getPoliceToken() {
    const res = await fetch('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: 'police-dashboard',
        role: 'POLICE'
      })
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch token: ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('No token in response');
    }
    return data.token;
  }

  function updateWsStatus(kind, text) {
    wsStatusEl.textContent = text;
    wsStatusEl.className = `badge ${kind}`;
  }

  async function bootstrap() {
    try {
      const origin = window.location.origin;
      const wsUrl = origin.replace(/^http/, 'ws');
      wsEndpointEl.textContent = wsUrl.replace(/^ws:\/\//, '');

      initMap();

      updateWsStatus('idle', 'Requesting token…');
      appendLog('system', 'system', 'Requesting POLICE token');
      const token = await getPoliceToken();

      updateWsStatus('idle', 'Connecting…');
      appendLog('system', 'system', 'Opening WebSocket connection');

      const ws = new WebSocket(wsUrl);

      ws.addEventListener('open', () => {
        updateWsStatus('ok', 'Connected');
        appendLog('system', 'system', 'WebSocket connected, sending REGISTER');
        ws.send(
          JSON.stringify({
            type: 'REGISTER',
            payload: {
              role: 'POLICE',
              token
            }
          })
        );
      });

      ws.addEventListener('close', () => {
        updateWsStatus('error', 'Disconnected');
        appendLog('system', 'system', 'WebSocket closed');
      });

      ws.addEventListener('error', () => {
        updateWsStatus('error', 'Error');
        appendLog('system', 'system', 'WebSocket error');
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { type, payload } = msg;

          if (type === 'REGISTERED') {
            appendLog('system', 'system', 'Registered as POLICE', payload);
            return;
          }

          if (type === 'LIVE_LOCATION_UPDATE') {
            const ride = ensureRide(payload.rideId);
            ride.lastLocation = payload.location;
            ride.lastLocationRole = payload.role;
            ride.lastUpdated = Date.now();
            appendLog('loc', 'location', `Ride ${payload.rideId} location`, payload);
            if (sosFocusRideId && sosFocusRideId === payload.rideId) {
              updateSosMarker(ride);
            }
          } else if (type === 'SOS_TRIGGERED') {
            const ride = ensureRide(payload.rideId);
            ride.sosCount += 1;
            ride.lastUpdated = Date.now();
            appendLog('SOS', 'sos', `SOS for ride ${payload.rideId}`, payload);
            sosFocusRideId = payload.rideId;
            updateSosMarker(ride);
          } else if (type === 'HARASSMENT_FLAG') {
            const ride = ensureRide(payload.rideId);
            ride.harassmentCount += 1;
            ride.lastUpdated = Date.now();
            appendLog('HRM', 'harassment', `Harassment flagged for ride ${payload.rideId}`, payload);
          } else if (type === 'MEDIA_AVAILABLE') {
            const ride = ensureRide(payload.rideId);
            ride.mediaCount += 1;
            ride.lastUpdated = Date.now();
            mediaCount += 1;
            appendLog('MEDIA', 'media', `Media for ride ${payload.rideId}`, payload);
          } else if (type === 'DEVICE_DISCONNECTED') {
            appendLog('DEV', 'system', `Device disconnected for ride ${payload.rideId}`, payload);
          } else if (type === 'ERROR') {
            appendLog('ERR', 'system', payload.message || 'Server error', payload);
          } else {
            appendLog('EVT', 'system', type, payload);
          }

          recomputeStats();
          renderRides();
        } catch (err) {
          appendLog('ERR', 'system', 'Failed to parse message', { raw: event.data });
        }
      });
    } catch (err) {
      console.error(err);
      updateWsStatus('error', 'Failed');
      appendLog('ERR', 'system', 'Failed to bootstrap dashboard', { message: err.message });
    }
  }

  window.addEventListener('load', bootstrap);
})();


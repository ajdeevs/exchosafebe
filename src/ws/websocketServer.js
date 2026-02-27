const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const rideManager = require('../services/rideManager');
const sosService = require('../services/sosService');
const heartbeatMonitor = require('../services/heartbeatMonitor');
const { CLIENT_EVENTS, SERVER_EVENTS } = require('../constants/events');
const { ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE } = require('../constants/roles');

function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (!payload || !payload.sub || !payload.role) {
    throw new Error('Invalid token payload');
  }
  return {
    id: payload.sub,
    role: payload.role
  };
}

module.exports = function initWebSocketServer(httpServer){
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (socket) => {
    let registered = false;

    socket.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const { type, payload } = data;

        if (!registered) {
          if (type !== CLIENT_EVENTS.REGISTER) {
            socket.send(
              JSON.stringify({
                type: SERVER_EVENTS.ERROR,
                payload: { message: 'First message must be REGISTER' }
              })
            );
            socket.close();
            return;
          }
          await handleRegister(socket, payload);
          registered = true;
          return;
        }

        await handleEvent(socket, type, payload);
      } catch (err) {
        console.error('WebSocket message error:', err);
        try {
          socket.send(
            JSON.stringify({
              type: SERVER_EVENTS.ERROR,
              payload: { message: 'Invalid message or server error' }
            })
          );
        } catch (e) {
          // ignore
        }
      }
    });

    socket.on('close', async (code, reason) => {
      try {
        await rideManager.handleDisconnect(socket, code, reason);
      } catch (err) {
        console.error('Error handling disconnect:', err);
      }
    });
  });

  async function handleRegister(socket, payload) {
    const { token, role, rideId } = payload || {};
    if (!token || !role) {
      socket.send(
        JSON.stringify({
          type: SERVER_EVENTS.ERROR,
          payload: { message: 'token and role are required for REGISTER' }
        })
      );
      socket.close();
      return;
    }

    let user;
    try {
      user = verifyToken(token);
    } catch (err) {
      console.error('WebSocket auth error:', err);
      socket.send(
        JSON.stringify({
          type: SERVER_EVENTS.ERROR,
          payload: { message: 'Invalid token' }
        })
      );
      socket.close();
      return;
    }

    if (user.role !== role) {
      socket.send(
        JSON.stringify({
          type: SERVER_EVENTS.ERROR,
          payload: { message: 'Role mismatch' }
        })
      );
      socket.close();
      return;
    }

    if (role === ROLE_PASSENGER || role === ROLE_CAB_DEVICE) {
      if (!rideId && role === ROLE_PASSENGER) {
        try {
          const activeRide = await require('../prismaClient').ride.findFirst({
            where: {
              passengerId: user.id,
              status: { in: ['STARTED', 'IN_PROGRESS'] }
            }
          });
          if (activeRide) {
            rideId = activeRide.id;
          } else {
             socket.send(
               JSON.stringify({
                 type: SERVER_EVENTS.ERROR,
                 payload: { message: 'No active ride found for this passenger' }
               })
             );
             socket.close();
             return;
          }
        } catch (dbErr) {
          console.error('Error finding passenger active ride:', dbErr);
          socket.close();
          return;
        }
      } else if (!rideId && role !== ROLE_CAB_DEVICE) {
        socket.send(
          JSON.stringify({
            type: SERVER_EVENTS.ERROR,
            payload: { message: 'rideId is required for this role' }
          })
        );
        socket.close();
        return;
      }
    }

    if (role === ROLE_PASSENGER) {
      rideManager.attachPassengerSocket(rideId, socket, user.id);
    } else if (role === ROLE_CAB_DEVICE) {
      if (!rideId) {
        // Cab devices might just connect and look for their assigned active ride
        try {
          const activeRide = await require('../prismaClient').ride.findFirst({
            where: {
              cabDeviceId: user.id,
              status: { in: ['STARTED', 'IN_PROGRESS'] }
            }
          });
          if (activeRide) {
            rideId = activeRide.id;
            rideManager.attachCabSocket(rideId, socket, user.id);
          } else {
            // No active ride currently, but keep them connected as an "Idle Cab"
            // so we can push a rideId to them when one is booked.
            rideManager.registerIdleCab(user.id, socket);
          }
        } catch (dbErr) {
          console.error('Error finding cab active ride:', dbErr);
          socket.close();
          return;
        }
      } else {
        rideManager.attachCabSocket(rideId, socket, user.id);
      }
    } else if (role === ROLE_POLICE) {
      rideManager.attachPoliceSocket(socket, user.id);
    } else {
      socket.send(
        JSON.stringify({
          type: SERVER_EVENTS.ERROR,
          payload: { message: 'Unsupported role' }
        })
      );
      socket.close();
      return;
    }

    socket.send(
      JSON.stringify({
        type: SERVER_EVENTS.REGISTERED,
        payload: { role, rideId: rideId || null }
      })
    );
  }

  async function handleEvent(socket, type, payload) {
    const meta = rideManager.socketIndex.get(socket);
    if (!meta) {
      socket.send(
        JSON.stringify({
          type: SERVER_EVENTS.ERROR,
          payload: { message: 'Socket not registered' }
        })
      );
      return;
    }

    const { rideId, role } = meta;

    switch (type) {
      case CLIENT_EVENTS.HEARTBEAT:
        if (role === ROLE_PASSENGER || role === ROLE_CAB_DEVICE) {
          heartbeatMonitor.update(rideId, role);
        }
        break;

      case CLIENT_EVENTS.LOCATION_UPDATE:
        if (!payload || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') {
          socket.send(
            JSON.stringify({
              type: SERVER_EVENTS.ERROR,
              payload: { message: 'Invalid location payload' }
            })
          );
          return;
        }
        if (role === ROLE_PASSENGER || role === ROLE_CAB_DEVICE) {
          rideManager.updateLocation(rideId, role, {
            lat: payload.lat,
            lng: payload.lng
          });
        }
        break;

      case CLIENT_EVENTS.HARASSMENT_DETECTED:
        if (role !== ROLE_CAB_DEVICE) {
          socket.send(
            JSON.stringify({
              type: SERVER_EVENTS.ERROR,
              payload: { message: 'HARASSMENT_DETECTED only allowed from CAB_DEVICE' }
            })
          );
          return;
        }
        if (!payload || typeof payload.confidence !== 'number') {
          socket.send(
            JSON.stringify({
              type: SERVER_EVENTS.ERROR,
              payload: { message: 'Invalid harassment payload' }
            })
          );
          return;
        }
        await sosService.notifyPoliceHarassment(rideId, payload.confidence);
        break;

      case CLIENT_EVENTS.SOS_RAISED:
        if (role === ROLE_PASSENGER || role === ROLE_CAB_DEVICE) {
          const imageUrl = payload && payload.imageUrl ? payload.imageUrl : null;
          await sosService.triggerSOS(rideId, 'manual_sos', imageUrl);
        } else {
          socket.send(
            JSON.stringify({
              type: SERVER_EVENTS.ERROR,
              payload: { message: 'SOS_RAISED not allowed for this role' }
            })
          );
        }
        break;

      default:
        socket.send(
          JSON.stringify({
            type: SERVER_EVENTS.ERROR,
            payload: { message: `Unknown event type: ${type}` }
          })
        );
    }
  }

  console.log('WebSocket server initialized');
};

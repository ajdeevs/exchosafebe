const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../prismaClient');
const { ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE } = require('../constants/roles');

const router = express.Router();

const ALLOWED_ROLES = new Set([ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE]);

function issueToken(userId, role) {
  const payload = { sub: userId, role };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
}

// Simple token issuer for testing and internal tools.
router.post('/token', (req, res) => {
  try {
    const { userId, role } = req.body || {};

    if (!userId || !role) {
      return res.status(400).json({ error: 'userId and role are required' });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const token = issueToken(userId, role);
    return res.status(201).json({ token });
  } catch (err) {
    console.error('Error issuing token:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PASSENGER AUTH

router.post('/passenger/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'PASSENGER'
      }
    });

    const token = issueToken(user.id, ROLE_PASSENGER);
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: 'PASSENGER',
        name: name || null
      }
    });
  } catch (err) {
    console.error('Passenger signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/passenger/signin', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'PASSENGER') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user.id, ROLE_PASSENGER);
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: 'PASSENGER'
      }
    });
  } catch (err) {
    console.error('Passenger signin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DRIVER AUTH + SAFE PROFILE

router.post('/driver/signup', async (req, res) => {
  try {
    const { email, password, fullName, licenseNumber, licensePlate, cabDeviceId } = req.body || {};
    if (!email || !password || !fullName || !licenseNumber || !licensePlate) {
      return res.status(400).json({
        error: 'email, password, fullName, licenseNumber and licensePlate are required'
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'DRIVER',
        driverProfile: {
          create: {
            fullName,
            licenseNumber,
            licensePlate,
            cabDeviceId: cabDeviceId || null
          }
        }
      },
      include: {
        driverProfile: true
      }
    });

    const token = issueToken(user.id, ROLE_CAB_DEVICE);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: 'DRIVER',
        driverProfile: user.driverProfile
      }
    });
  } catch (err) {
    console.error('Driver signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/driver/signin', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { driverProfile: true }
    });
    if (!user || user.role !== 'DRIVER') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user.id, ROLE_CAB_DEVICE);

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: 'DRIVER',
        driverProfile: user.driverProfile
      }
    });
  } catch (err) {
    console.error('Driver signin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// INITIALIZE RIDE
router.post('/ride/create', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.sub || payload.role !== ROLE_PASSENGER) {
      return res.status(403).json({ error: 'Only passengers can create rides' });
    }

    const { driverId, cabDeviceId } = req.body || {};
    if (!driverId || !cabDeviceId) {
      return res.status(400).json({ error: 'driverId and cabDeviceId are required' });
    }

    // Create the active ride in the database
    const newRide = await prisma.ride.create({
      data: {
        passengerId: payload.sub,
        driverId,
        cabDeviceId,
        status: 'BOOKED'
      }
    });

    return res.status(201).json({
      message: 'Ride created successfully',
      ride: newRide
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('Create ride error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POLICE DASHBOARD - GET ACTIVE RIDES AND TRACES
router.get('/police/rides', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.sub || payload.role !== ROLE_POLICE) {
      return res.status(403).json({ error: 'Only police can view all active rides' });
    }

    // Fetch all rides that are not explicitly ended, including any SOS records and their image URLs
    const activeRides = await prisma.ride.findMany({
      where: {
        status: {
          not: 'ENDED'
        }
      },
      include: {
        sosEvents: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.status(200).json({ rides: activeRides });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('Police fetch active rides error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POLICE DASHBOARD - RESOLVE A RIDE/SOS
router.post('/police/rides/resolve', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.sub || payload.role !== ROLE_POLICE) {
      return res.status(403).json({ error: 'Only police can resolve rides' });
    }

    const { rideId } = req.body || {};
    if (!rideId) {
      return res.status(400).json({ error: 'rideId is required' });
    }

    // Update the ride status to ENDED
    const updatedRide = await prisma.ride.update({
      where: { id: rideId },
      data: { status: 'ENDED' }
    });

    // Automatically resolve any active SOS events tied to this ride
    await prisma.sosEvent.updateMany({
      where: { rideId: rideId, status: 'ACTIVE' },
      data: { status: 'RESOLVED' }
    });

    return res.status(200).json({
      message: 'Ride and tied SOS events resolved successfully',
      ride: updatedRide
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Ride not found' });
    }
    console.error('Police resolve ride error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POLICE DASHBOARD - RESOLVE A SPECIFIC SOS EVENT
router.post('/police/sos/resolve', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.sub || payload.role !== ROLE_POLICE) {
      return res.status(403).json({ error: 'Only police can resolve SOS events' });
    }

    const { sosId } = req.body || {};
    if (!sosId) {
      return res.status(400).json({ error: 'sosId is required' });
    }

    // Update the specific SOS event status to RESOLVED
    const updatedSos = await prisma.sosEvent.update({
      where: { id: sosId },
      data: { status: 'RESOLVED' }
    });

    return res.status(200).json({
      message: 'SOS resolved successfully',
      sos: updatedSos
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'SOS event not found' });
    }
    console.error('Police resolve SOS error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

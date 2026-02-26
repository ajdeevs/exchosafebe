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

module.exports = router;

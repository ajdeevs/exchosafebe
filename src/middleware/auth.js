const jwt = require('jsonwebtoken');
const { ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE } = require('../constants/roles');

const ALLOWED_ROLES = new Set([ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE]);

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') return parts[1];
  return null;
}

function auth(requiredRoles) {
  return function (req, res, next) {
    try {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Missing authorization token' });
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload || !payload.sub || !payload.role) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      if (!ALLOWED_ROLES.has(payload.role)) {
        return res.status(403).json({ error: 'Invalid role' });
      }

      if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(payload.role)) {
        return res.status(403).json({ error: 'Insufficient role' });
      }

      req.user = {
        id: payload.sub,
        role: payload.role
      };

      next();
    } catch (err) {
      console.error('Auth error:', err);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

module.exports = auth;

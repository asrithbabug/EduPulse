const jwt = require('jsonwebtoken');

/**
 * Enterprise (Super Admin) middleware.
 * Verifies JWT and ensures user role is 'enterprise_admin'.
 */
module.exports = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'enterprise_admin') {
      return res.status(403).json({ error: 'Enterprise admin access required' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

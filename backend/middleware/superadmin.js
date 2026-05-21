const auth = (req, res, next) => {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Access denied. Superadmin required.' });
  }
  next();
};

module.exports = auth;
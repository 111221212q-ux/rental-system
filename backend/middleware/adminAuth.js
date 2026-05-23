const auth = require('./auth');

const admin = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      next();
    } else {
      res.status(403).json({ error: '需要管理员权限' });
    }
  });
};

module.exports = admin;
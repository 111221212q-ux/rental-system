const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { findUserByUsername, findUserByEmail, addUser } = require('../mockUsers');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: '7d'
  });
};

exports.register = [
  body('username').trim().isLength({ min: 3, max: 20 }).withMessage('学号长度应为3-20个字符'),
  body('password').isLength({ min: 6 }).withMessage('密码长度至少6个字符'),
  body('role').optional().isIn(['user', 'admin', 'superadmin']),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { username, password, role, phone, department } = req.body;

      const existingUser = findUserByUsername(username) || findUserByEmail(`${username}@student.edu`);
      if (existingUser) {
        return res.status(400).json({ error: '学号已存在' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = {
        username,
        email: `${username}@student.edu`,
        password: hashedPassword,
        role: role || 'user',
        phone,
        department
      };

      addUser(newUser);

      const token = generateToken(newUser.id);

      res.status(201).json({
        message: '注册成功',
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.login = [
  body('username').notEmpty().withMessage('学号不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { username, password } = req.body;

      const user = findUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: '学号或密码错误' });
      }

      if (!user.active) {
        return res.status(401).json({ error: '账号已被禁用' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: '学号或密码错误' });
      }

      const token = generateToken(user.id);

      res.json({
        message: '登录成功',
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
];

exports.getMe = (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.userId,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role,
        phone: req.user.phone,
        department: req.user.department
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
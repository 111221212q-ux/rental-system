const express = require('express');
const app = express();
app.use(express.json());
app.use(cors());

// 测试路由
app.post('/api/auth/login', (req, res) => {
  console.log('Login request:', req.body);
  const { username, password } = req.body;

  if (username === 'test' && password === 'test123') {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: '1' }, process.env.JWT_SECRET || 'your-secret-key');

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: '1',
        username: 'test',
        email: 'test@test.com',
        role: 'user'
      }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/register', (req, res) => {
  console.log('Register request:', req.body);
  const { username, password } = req.body;

  if (username && password && password.length >= 6) {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: Date.now().toString() }, process.env.JWT_SECRET || 'your-secret-key');

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: Date.now().toString(),
        username,
        email: `${username}@test.com`,
        role: 'user'
      }
    });
  } else {
    res.status(400).json({ error: 'Invalid registration data' });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});
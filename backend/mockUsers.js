// 模拟用户数据库
const mockUsers = [
  {
    id: '1',
    username: '20240001',
    email: '20240001@student.edu',
    password: '$2a$10$rKv9Qz6w4sZ6mM8yQn2jUOj8Z8R0K8Y8M8K8Y8K8K8K8K8K8K8K', // 密码: 123456
    role: 'user',
    active: true
  },
  {
    id: '2',
    username: '20240002',
    email: '20240002@student.edu',
    password: '$2a$10$rKv9Qz6w4sZ6mM8yQn2jUOj8Z8R0K8Y8M8K8Y8K8K8K8K8K8K8K', // 密码: 123456
    role: 'user',
    active: true
  },
  {
    id: '3',
    username: 'admin',
    email: 'admin@rental.edu',
    password: '$2a$10$rKv9Qz6w4sZ6mM8yQn2jUOj8Z8R0K8Y8M8K8Y8K8K8K8K8K8K8K8K', // 密码: admin123
    role: 'admin',
    active: true
  }
];

// 查找用户
const findUserByUsername = (username) => {
  return mockUsers.find(user => user.username === username);
};

// 查找用户
const findUserByEmail = (email) => {
  return mockUsers.find(user => user.email === email);
};

// 添加用户
const addUser = (user) => {
  const newUser = {
    id: (mockUsers.length + 1).toString(),
    ...user,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  mockUsers.push(newUser);
  return newUser;
};

module.exports = {
  mockUsers,
  findUserByUsername,
  findUserByEmail,
  addUser
};
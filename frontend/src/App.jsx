import { useState, useEffect } from 'react';
import api from './utils/api';

function App() {
  const [username, setUsername] = useState(() => (
    localStorage.getItem('rental_remember') === 'true'
      ? localStorage.getItem('rental_username') || ''
      : ''
  ));
  const [password, setPassword] = useState(() => (
    localStorage.getItem('rental_remember') === 'true'
      ? localStorage.getItem('rental_password') || ''
      : ''
  ));
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedItem, setSelectedItem] = useState(null);
  const [rentalData, setRentalData] = useState({
    startDate: '',
    endDate: '',
    quantity: 1,
    reason: ''
  });
  const [usersStatsData, setUsersStatsData] = useState([]);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('rental_remember') === 'true');
  const [itemsData, setItemsData] = useState([]);
  const [rentalsData, setRentalsData] = useState([]);
  const [myRentalsData, setMyRentalsData] = useState([]);
  const [, setLoading] = useState(true);

  // 新增物品相关状态
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItem, setNewItem] = useState({
    name: '',
    code: '',
    category: '电子产品',
    description: '',
    totalStock: 1,
    maxRentalDays: 7,
    requireApproval: true,
    value: 1000
  });

  // 样式常量
  const STYLES = {
    container: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8',
    card: 'bg-white rounded-lg shadow-md p-6',
    button: {
      primary: 'bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md transition-colors',
      secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md transition-colors',
      danger: 'bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md transition-colors',
      success: 'bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md transition-colors'
    },
    input: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
    select: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isLogin) {
      try {
        // 调用登录API
        const response = await api.post('/auth/login', {
          username,
          password
        });

        // 保存token
        localStorage.setItem('token', response.data.token);
        alert(`登录成功！\n学号: ${username}`);
        setLoggedIn(true);

        // 保存登录状态到localStorage
        if (rememberMe) {
          localStorage.setItem('rental_username', username);
          localStorage.setItem('rental_remember', 'true');
          localStorage.setItem('rental_password', password);
        }
      } catch (error) {
        alert(`登录失败！\n${error.response?.data?.message || '请检查用户名和密码'}`);
      }
    } else {
      try {
        // 调用注册API
        const response = await api.post('/auth/register', {
          username,
          password
        });

        // 保存token
        localStorage.setItem('token', response.data.token);
        alert(`注册成功！\n学号: ${username}`);
        setTimeout(() => {
          setIsLogin(true);
          setMessage('');
        }, 2000);
      } catch (error) {
        alert(`注册失败！\n${error.response?.data?.message || '请检查输入信息'}`);
      }
    }
  };

  const handleLogout = () => {
    setLoggedIn(false);
    setUsername('');
    setPassword('');
    setMessage('');
    setIsLogin(true);
    setCurrentPage('dashboard');
    setSelectedItem(null);

    // 清除所有保存的信息
    localStorage.removeItem('token');
    localStorage.removeItem('rental_username');
    localStorage.removeItem('rental_password');
    localStorage.removeItem('rental_remember');
  };

  const handleApplyRent = (item) => {
    setSelectedItem(item);
    setCurrentPage('apply');
  };

  const handleApplySubmit = async (e) => {
    e.preventDefault();

    try {
      await api.post('/rentals', {
        itemId: selectedItem.id,
        quantity: rentalData.quantity,
        startDate: rentalData.startDate,
        endDate: rentalData.endDate,
        reason: rentalData.reason
      });

      alert(`申请提交成功！\n物品：${selectedItem.name}\n租期：${rentalData.startDate} 至 ${rentalData.endDate}\n数量：${rentalData.quantity}\n\n请等待管理员审核！`);
      setCurrentPage('items');
      setSelectedItem(null);
      setRentalData({
        startDate: '',
        endDate: '',
        quantity: 1,
        reason: ''
      });

      // 重新加载用户的租借记录
      const myRentalsResponse = await api.get('/rentals/my');
      setMyRentalsData(myRentalsResponse.data);
    } catch (error) {
      alert('申请提交失败：' + (error.response?.data?.error || error.message));
    }
  };

  const handleCancelApply = () => {
    setSelectedItem(null);
    setCurrentPage('items');
    setRentalData({
      startDate: '',
      endDate: '',
      quantity: 1,
      reason: ''
    });
  };

  // 加载管理员审核列表
  const loadRentalsForAdmin = async () => {
    try {
      const response = await api.get('/rentals');
      setRentalsData(response.data);
    } catch (error) {
      alert('加载申请列表失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 处理审批申请
  const handleApproveRental = async (rentalId, status) => {
    try {
      const adminNotes = document.querySelector(`input[placeholder="审批备注（可选）"]`)?.value || '';

      await api.put(`/rentals/${rentalId}/approve`, {
        status,
        adminNotes
      });

      alert(`申请已${status === 'approved' ? '批准' : '拒绝'}`);
      loadRentalsForAdmin(); // 刷新列表
    } catch (error) {
      alert('审批失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 加载库存管理页面
  const loadItemsForInventory = async () => {
    try {
      // 重新获取最新数据
      const itemsResponse = await api.get('/items');
      setItemsData(itemsResponse.data);
      alert('库存列表已刷新');
    } catch (error) {
      alert('加载库存失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 处理库存操作
  const handleStockAction = async (itemId, action, quantity) => {
    try {
      const numQuantity = parseInt(quantity);
      if (!numQuantity || numQuantity < 1) {
        alert('请输入有效的数量');
        return;
      }

      const response = await api.put(`/items/${itemId}/stock`, {
        action,
        quantity: numQuantity
      });

      alert(response.data.message);
      // 重新加载物品列表
      loadItemsForInventory();
    } catch (error) {
      alert('操作失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 加载用户统计数据
  const loadUsersStats = async () => {
    try {
      const response = await api.get('/admin/users');
      setUsersStatsData(response.data);
      alert('用户统计已刷新');
    } catch (error) {
      alert('加载用户统计失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 处理新增物品
  const handleAddItem = async () => {
    try {
      if (!newItem.name || !newItem.code) {
        alert('请填写物品名称和编码');
        return;
      }

      await api.post('/items', {
        ...newItem,
        availableStock: newItem.totalStock,
        status: 'available'
      });

      alert('物品添加成功！');
      setShowAddItemModal(false);
      setNewItem({
        name: '',
        code: '',
        category: '电子产品',
        description: '',
        totalStock: 1,
        maxRentalDays: 7,
        requireApproval: true,
        value: 1000
      });
      loadItemsForInventory();
    } catch (error) {
      alert('添加物品失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 处理删除物品
  const handleDeleteItem = async (itemId) => {
    if (!confirm('确定要删除这个物品吗？')) {
      return;
    }

    try {
      await api.delete(`/items/${itemId}`);
      alert('物品删除成功！');
      loadItemsForInventory();
    } catch (error) {
      alert('删除物品失败: ' + (error.response?.data?.error || error.message));
    }
  };

  // 当 rememberMe 状态改变时更新 localStorage
  useEffect(() => {
    if (rememberMe) {
      localStorage.setItem('rental_remember', 'true');
    } else {
      localStorage.removeItem('rental_remember');
    }
  }, [rememberMe]);

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      if (loggedIn) {
        try {
          // 加载物品列表
          const itemsResponse = await api.get('/items');
          setItemsData(itemsResponse.data);

          // 加载用户的租借记录
          const myRentalsResponse = await api.get('/rentals/my');
          setMyRentalsData(myRentalsResponse.data);
        } catch (error) {
          console.error('加载数据失败:', error);
        }
      }
      setLoading(false);
    };

    loadData();
  }, [loggedIn]);

  if (loggedIn) {
    return (
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center space-x-8">
                <h1 className="text-xl font-bold text-gray-900">物品租借系统</h1>
                <div className="flex space-x-4">
                  <button
                    onClick={() => setCurrentPage('dashboard')}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      currentPage === 'dashboard'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    仪表板
                  </button>
                  <button
                    onClick={() => setCurrentPage('items')}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      currentPage === 'items'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    物品列表
                  </button>
                  <button
                    onClick={() => setCurrentPage('rentals')}
                    className={`px-3 py-2 rounded-md text-sm font-medium ${
                      currentPage === 'rentals'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    我的租借
                  </button>
                  {/* 管理员入口 */}
                  {(username === 'admin' || username === 'superadmin') && (
                    <div className="relative group">
                      <button className="px-3 py-2 rounded-md text-sm font-medium text-purple-600 hover:bg-purple-100">
                        管理员
                      </button>
                      <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 hidden group-hover:block z-50">
                        <button
                          onClick={() => setCurrentPage('admin')}
                          className={`block w-full text-left px-4 py-2 text-sm ${
                            currentPage === 'admin' ? 'bg-purple-100 text-purple-700' : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          审核申请
                        </button>
                        <button
                          onClick={() => setCurrentPage('inventory')}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          库存管理
                        </button>
                        <button
                          onClick={() => setCurrentPage('users')}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          用户租借情况
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-gray-700">欢迎, {username}</span>
                <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md"
                >
                  退出登录
                </button>
              </div>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentPage === 'dashboard' && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold mb-4">租借管理</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-blue-800">可租借物品</h3>
                  <p className="text-blue-600 mt-2">{itemsData.filter(i => i.status === 'available' && i.availableStock > 0).length} 件物品可用</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-green-800">我的租借</h3>
                  <p className="text-green-600 mt-2">{myRentalsData.filter(r => r.status === 'approved').length} 个进行中</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h3 className="font-semibold text-yellow-800">待审核</h3>
                  <p className="text-yellow-600 mt-2">{myRentalsData.filter(r => r.status === 'pending').length} 个申请</p>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-3">快捷操作</h3>
                <div className="flex space-x-4">
                  <button
                    onClick={() => setCurrentPage('items')}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
                  >
                    新建租借申请
                  </button>
                  <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md">
                    查看租借记录
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentPage === 'items' && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h2 className="text-2xl font-bold">可租借物品</h2>
                <p className="text-gray-600 mt-1">共 {itemsData.filter(i => i.status === 'available' && i.availableStock > 0).length} 件物品可用</p>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {itemsData
                    .filter(item => item.status === 'available' && item.availableStock > 0)
                    .map((item) => (
                    <div key={item.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold text-lg">{item.name}</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            编号: {item.code} | 类别: {item.category}
                          </p>
                          <p className="text-sm text-gray-600">
                            库存: {item.availableStock}/{item.totalStock} | 日租金: ¥{item.dailyRate}
                          </p>
                          {item.description && (
                            <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <button
                            onClick={() => handleApplyRent(item)}
                            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md transition-colors"
                          >
                            申请租借
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {currentPage === 'rentals' && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h2 className="text-2xl font-bold">我的租借记录</h2>
              </div>
              <div className="p-6">
                {myRentalsData.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    暂无租借记录
                  </div>
                ) : (
                  <div className="space-y-4">
                    {myRentalsData.map((rental) => (
                      <div key={rental.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-lg">{rental.itemName}</h3>
                            <p className="text-sm text-gray-600">
                              申请时间: {new Date(rental.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-600">
                              租期: {new Date(rental.startDate).toLocaleDateString()} 至 {new Date(rental.endDate).toLocaleDateString()}
                            </p>
                            <p className="text-sm text-gray-600">
                              数量: {rental.quantity} | 日租金: ¥{rental.dailyRate || 0}
                            </p>
                            <p className="text-sm text-gray-600">
                              总费用: ¥{(rental.quantity * (rental.dailyRate || 0)).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-600 mt-2">
                              用途: {rental.reason}
                            </p>
                            {rental.adminNotes && (
                              <p className="text-sm text-blue-600 mt-2">
                                管理员备注: {rental.adminNotes}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <span className={`px-2 py-1 rounded text-sm ${
                              rental.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                              rental.status === 'approved' ? 'bg-green-100 text-green-800' :
                              rental.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {rental.status === 'pending' ? '待审核' :
                               rental.status === 'approved' ? '已批准' :
                               rental.status === 'rejected' ? '已拒绝' : '已归还'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentPage === 'apply' && selectedItem && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold">新建租借申请</h2>
                    <p className="text-gray-600 mt-1">物品：{selectedItem.name}</p>
                  </div>
                  <button
                    onClick={handleCancelApply}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="p-6">
                <form onSubmit={handleApplySubmit} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        开始日期 *
                      </label>
                      <input
                        type="date"
                        value={rentalData.startDate}
                        onChange={(e) => setRentalData({...rentalData, startDate: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        结束日期 *
                      </label>
                      <input
                        type="date"
                        value={rentalData.endDate}
                        onChange={(e) => setRentalData({...rentalData, endDate: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      租借数量 *
                    </label>
                    <select
                      value={rentalData.quantity}
                      onChange={(e) => setRentalData({...rentalData, quantity: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    >
                      {[1, 2, 3, 4, 5].map(num => (
                        <option key={num} value={num}>{num}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      租借用途 *
                    </label>
                    <textarea
                      value={rentalData.reason}
                      onChange={(e) => setRentalData({...rentalData, reason: e.target.value})}
                      placeholder="请说明租借用途..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      rows={3}
                      required
                    />
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-gray-600">日租金：¥{selectedItem.dailyRate}</p>
                        <p className="text-sm text-gray-600">
                          租期：{rentalData.startDate} 至 {rentalData.endDate}
                        </p>
                        <p className="text-lg font-semibold text-blue-600">
                          预计费用：¥{(selectedItem.dailyRate * rentalData.quantity).toLocaleString()}
                        </p>
                      </div>
                      <div className="space-x-3">
                        <button
                          type="button"
                          onClick={handleCancelApply}
                          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
                        >
                          提交申请
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* 管理员页面 */}
        {currentPage === 'admin' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">管理员审核</h2>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <button
                  onClick={loadRentalsForAdmin}
                  className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md"
                >
                  刷新申请列表
                </button>
              </div>
              <div className="space-y-4">
                {rentalsData.map((rental) => (
                  <div key={rental.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-lg">{rental.itemName}</h3>
                        <p className="text-sm text-gray-600">
                          申请人: {rental.userName} | 申请时间: {new Date(rental.createdAt).toLocaleString()}
                        </p>
                        <p className="text-sm text-gray-600">
                          租期: {new Date(rental.startDate).toLocaleDateString()} 至 {new Date(rental.endDate).toLocaleDateString()} | 数量: {rental.quantity}
                        </p>
                        <p className="text-sm text-gray-600">
                          用途: {rental.reason}
                        </p>
                        {rental.adminNotes && (
                          <p className="text-sm text-blue-600">
                            备注: {rental.adminNotes}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded text-sm ${
                          rental.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          rental.status === 'approved' ? 'bg-green-100 text-green-800' :
                          rental.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {rental.status === 'pending' ? '待审核' :
                           rental.status === 'approved' ? '已批准' :
                           rental.status === 'rejected' ? '已拒绝' : '已归还'}
                        </span>
                      </div>
                    </div>
                    {rental.status === 'pending' && (
                      <div className="mt-4 pt-4 border-t">
                        <div className="flex space-x-3">
                          <input
                            type="text"
                            placeholder="审批备注（可选）"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                            value={rental.approvalNotes || ''}
                            onChange={(e) => rental.approvalNotes = e.target.value}
                          />
                          <button
                            onClick={() => handleApproveRental(rental.id, 'approved')}
                            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md"
                          >
                            批准
                          </button>
                          <button
                            onClick={() => handleApproveRental(rental.id, 'rejected')}
                            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md"
                          >
                            拒绝
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 库存管理页面 */}
        {currentPage === 'inventory' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">库存管理</h2>
                  <p className="text-gray-600 mt-1">管理物品的入库和出库</p>
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowAddItemModal(true)}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
                  >
                    新增物品
                  </button>
                  <button
                    onClick={loadItemsForInventory}
                    className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md"
                  >
                    刷新列表
                  </button>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        物品名称
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        编号
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        类别
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        库存
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最大租借天数
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        库存
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        日租金
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {itemsData.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{item.name}</div>
                          <div className="text-sm text-gray-500">{item.description}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.code}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.category}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            item.availableStock === 0
                              ? 'bg-red-100 text-red-800'
                              : item.availableStock < item.totalStock * 0.3
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {item.availableStock}/{item.totalStock}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.maxRentalDays} 天
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            item.status === 'available' ? 'bg-green-100 text-green-800' :
                            item.status === 'low_stock' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {item.status === 'available' ? '可租借' :
                             item.status === 'low_stock' ? '库存不足' : '不可租借'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex space-x-2">
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                min="1"
                                max={item.totalStock}
                                defaultValue="1"
                                id={`add-${item.id}`}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <button
                                onClick={() => handleStockAction(item.id, 'add', document.getElementById(`add-${item.id}`).value)}
                                className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                              >
                                入库
                              </button>
                            </div>
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                min="1"
                                max={item.availableStock}
                                defaultValue="1"
                                id={`remove-${item.id}`}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <button
                                onClick={() => handleStockAction(item.id, 'remove', document.getElementById(`remove-${item.id}`).value)}
                                className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                              >
                                出库
                              </button>
                            </div>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex space-x-2">
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                min="1"
                                max={item.totalStock}
                                defaultValue="1"
                                id={`add-${item.id}`}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <button
                                onClick={() => handleStockAction(item.id, 'add', document.getElementById(`add-${item.id}`).value)}
                                className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm"
                              >
                                入库
                              </button>
                            </div>
                            <div className="flex items-center space-x-1">
                              <input
                                type="number"
                                min="1"
                                max={item.availableStock}
                                defaultValue="1"
                                id={`remove-${item.id}`}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <button
                                onClick={() => handleStockAction(item.id, 'remove', document.getElementById(`remove-${item.id}`).value)}
                                className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                              >
                                出库
                              </button>
                            </div>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 用户租借情况页面 */}
        {currentPage === 'users' && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">用户租借情况</h2>
                  <p className="text-gray-600 mt-1">查看所有用户的租借统计</p>
                </div>
                <button
                  onClick={loadUsersStats}
                  className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md"
                >
                  刷新数据
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        用户名
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        总租借次数
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        进行中
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        待审核
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        最后租借时间
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {usersStatsData.map((user) => (
                      <tr key={user.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{user.username}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.totalRentals} 次
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            {user.activeRentals} 个
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            {user.pendingRentals} 个
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {user.lastRental
                            ? new Date(user.lastRental).toLocaleDateString()
                            : '暂无记录'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

          {showAddItemModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">新增物品</h3>
              <button
                onClick={() => setShowAddItemModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAddItem(); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物品名称 *
                </label>
                <input
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({...newItem, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="请输入物品名称"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物品编码 *
                </label>
                <input
                  type="text"
                  value={newItem.code}
                  onChange={(e) => setNewItem({...newItem, code: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="请输入物品编码"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物品类别
                </label>
                <select
                  value={newItem.category}
                  onChange={(e) => setNewItem({...newItem, category: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="电子产品">电子产品</option>
                  <option value="办公用品">办公用品</option>
                  <option value="运动器材">运动器材</option>
                  <option value="生活用品">生活用品</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  物品描述
                </label>
                <textarea
                  value={newItem.description}
                  onChange={(e) => setNewItem({...newItem, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  rows={3}
                  placeholder="请输入物品描述"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    总库存 *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newItem.totalStock}
                    onChange={(e) => setNewItem({...newItem, totalStock: parseInt(e.target.value)})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最大租借天数
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newItem.maxRentalDays}
                    onChange={(e) => setNewItem({...newItem, maxRentalDays: parseInt(e.target.value)})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    是否需要审核
                  </label>
                  <select
                    value={newItem.requireApproval ? 'true' : 'false'}
                    onChange={(e) => setNewItem({...newItem, requireApproval: e.target.value === 'true'})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="false">否</option>
                    <option value="true">是</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    物品价值
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newItem.value}
                    onChange={(e) => setNewItem({...newItem, value: parseInt(e.target.value)})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  图片URL
                </label>
                <input
                  type="text"
                  value={newItem.images}
                  onChange={(e) => setNewItem({...newItem, images: [e.target.value]})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="请输入图片链接（可选）"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
                >
                  确认添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md transform transition-all">
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-6 rounded-t-2xl">
          <h1 className="text-2xl font-bold text-center">物品租借系统</h1>
          <p className="text-center text-blue-100 mt-1">校园物品免费租借平台</p>
        </div>

        <form onSubmit={handleSubmit} id="auth-form" className="p-6">
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="text-gray-600">学号（用户名）</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (rememberMe) {
                    localStorage.setItem('rental_username', e.target.value);
                  }
                }}
                className={`${STYLES.input} pl-10`}
                placeholder="请输入学号"
                required
              />
              <svg className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="text-gray-600">密码</span>
            </label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (rememberMe) {
                    localStorage.setItem('rental_password', e.target.value);
                  }
                }}
                className={`${STYLES.input} pl-10`}
                placeholder="请输入密码"
                required
              />
              <svg className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          {isLogin && (
            <div className="mb-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => {
                    setRememberMe(e.target.checked);
                    if (e.target.checked) {
                      localStorage.setItem('rental_username', username);
                      localStorage.setItem('rental_password', password);
                    } else {
                      localStorage.removeItem('rental_username');
                      localStorage.removeItem('rental_password');
                    }
                  }}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-700">
                  记住我（下次自动登录）
                </label>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-md transition-colors mb-4"
          >
            {isLogin ? '登录' : '注册'}
          </button>
        </form>

        {message && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-md">
            {message}
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-500 hover:underline"
          >
            {isLogin ? '还没有账号？点击注册' : '已有账号？点击登录'}
          </button>
        </div>
      </div>
    </div>
  )}

export default App;

// pages/devices/devices.js
// 设备管理页面：对接云后台 SQLite 设备 API（主键 id），支持列表/添加/删除

const app = getApp();

Page({

  /**
   * 页面的初始数据
   */
  data: {
    devices: []   // 设备列表
  },

  /**
   * 生命周期函数--监听页面显示
   * 每次进入页面都刷新设备列表
   */
  onShow() {
    this.loadDevices();
  },

  /**
   * 2. 加载设备列表
   * GET /api/device/list，需携带 JWT Token
   */
  loadDevices() {
    // a. 获取 Token
    const token = app.getToken();

    // b. 无 Token 则跳转回登录页
    if (!token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // c. 发起 GET 请求，请求头携带 Authorization
    wx.request({
      url: 'http://127.0.0.1:3000/api/device/list',
      method: 'GET',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      success: (res) => {
        if (res.data.code === 0) {
          // d. 将返回的设备数组设置到 data
          this.setData({ devices: res.data.data });
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    });
  },

  /**
   * 3. 添加虚拟设备
   * POST /api/device/add，请求体 { is_virtual: true }
   */
  handleAddDevice() {
    const token = app.getToken();

    if (!token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // a. 发起 POST 请求添加虚拟设备
    wx.request({
      url: 'http://127.0.0.1:3000/api/device/add',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      data: { is_virtual: true },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '添加成功', icon: 'success' });
          // b. 添加成功后刷新列表
          this.loadDevices();
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    });
  },

  /**
   * 4. 删除设备
   * DELETE /api/devices/:id
   * @param {Object} e - 事件对象，e.currentTarget.dataset.id 为设备 id
   */
  handleDelete(e) {
    const token = app.getToken();
    const deviceId = e.currentTarget.dataset.id;

    if (!token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // 二次确认
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该设备吗？',
      success: (modalRes) => {
        if (!modalRes.confirm) return;

        // a. 发起 DELETE 请求
        wx.request({
          url: 'http://127.0.0.1:3000/api/devices/' + deviceId,
          method: 'DELETE',
          header: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          success: (res) => {
            if (res.data.code === 0) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              // b. 删除成功后刷新列表
              this.loadDevices();
            } else {
              wx.showToast({ title: res.data.message, icon: 'none' });
            }
          },
          fail: () => {
            wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
          }
        });
      }
    });
  }
});
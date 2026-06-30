// app.js
App({
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录
    wx.login({
      success: res => {
        // 发送 res.code 到后台换取 openId, sessionKey, unionId
      }
    })
  },
  globalData: {
    userInfo: null,
    token: null,
    apiBase: 'http://127.0.0.1:3000'
  },

  /**
   * 存储 Token 到内存和本地缓存
   * @param {string} token - JWT Token
   */
  setToken(token) {
    this.globalData.token = token;
    wx.setStorageSync('token', token);
  },

  /**
   * 获取 Token：优先内存，其次本地缓存
   * @returns {string|null}
   */
  getToken() {
    return this.globalData.token || wx.getStorageSync('token') || null;
  }
})

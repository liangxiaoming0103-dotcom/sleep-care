// pages/login/login.js
// 登录页面逻辑：收集手机号 + 密码，调用云后台 POST /api/auth/login

Page({

  /**
   * 页面的初始数据
   */
  data: {
    phone: '',     // 手机号（双向绑定）
    password: ''   // 密码（双向绑定）
  },

  /**
   * 生命周期函数--监听页面加载
   * 检查本地是否已有 Token，有则免登录直接跳转首页
   * 支持从注册页跳转过来时自动填入手机号
   */
  onLoad(options) {
    const token = getApp().getToken();
    if (token) {
      wx.switchTab({ url: '/pages/home/home' });
      return;
    }
    // 注册成功后跳转过来，自动填入手机号
    if (options && options.phone) {
      this.setData({ phone: options.phone });
    }
  },

  /**
   * 手机号输入绑定：更新 phone 字段
   */
  inputPhone(e) {
    this.setData({ phone: e.detail.value });
  },

  /**
   * 密码输入绑定：更新 password 字段
   */
  inputPassword(e) {
    this.setData({ password: e.detail.value });
  },

  /**
   * 跳转到注册页面
   */
  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  /**
   * 登录按钮点击处理
   * 校验手机号 + 密码非空后，调用云后台登录接口
   */
  handleLogin() {
    const { phone, password } = this.data;

    // ---- a. 校验 phone 和 password 不能为空 ----
    if (!phone.trim()) {
      wx.showToast({ title: '请输入手机号', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    // ---- b/c/d. 调用 wx.request 发送 POST 登录请求 ----
    wx.request({
      url: 'http://127.0.0.1:3000/api/auth/login',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { phone: phone.trim(), password },

      success(res) {
        // ---- e. 成功回调：解析响应 ----
        if (res.data.code === 0) {
          wx.setStorageSync('token', res.data.data.token);
          wx.showToast({ title: '登录成功', icon: 'success' });
          wx.switchTab({ url: '/pages/home/home' });
        } else if (res.data.code === 2001) {
          // 手机号未注册 → 弹窗引导跳转注册页
          wx.showModal({
            title: '账号不存在',
            content: '该手机号尚未注册，是否前往注册？',
            confirmText: '去注册',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.redirectTo({ url: `/pages/register/register?phone=${phone.trim()}` });
              }
            }
          });
        } else {
          // 服务端返回的其他业务错误
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },

      // ---- f. 失败回调：网络异常等 ----
      fail() {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    });
  }
});
// pages/register/register.js
// 注册页面逻辑：收集昵称 + 手机号 + 密码，调用 POST /api/auth/register

Page({

  data: {
    nickname: '',   // 昵称
    phone: '',      // 手机号
    password: '',   // 密码
    password2: ''   // 确认密码
  },

  goBack() {
    wx.navigateBack();
  },

  inputNickname(e) {
    this.setData({ nickname: e.detail.value });
  },

  inputPhone(e) {
    this.setData({ phone: e.detail.value });
  },

  inputPassword(e) {
    this.setData({ password: e.detail.value });
  },

  inputPassword2(e) {
    this.setData({ password2: e.detail.value });
  },

  /** 注册按钮点击 */
  handleRegister() {
    const { nickname, phone, password, password2 } = this.data;

    // 校验
    if (!nickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (!phone.trim() || !/^\d{11}$/.test(phone.trim())) {
      wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' });
      return;
    }
    if (!password || password.length < 6) {
      wx.showToast({ title: '密码长度不能少于6位', icon: 'none' });
      return;
    }
    if (password !== password2) {
      wx.showToast({ title: '两次密码输入不一致', icon: 'none' });
      return;
    }

    wx.request({
      url: 'http://127.0.0.1:3000/api/auth/register',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        phone: phone.trim(),
        password: password,
        nickname: nickname.trim(),
        role: 'patient' // ← 默认患者角色
      },

      success(res) {
        if (res.data.code === 0) {
          wx.showToast({ title: '注册成功', icon: 'success' });
          // 延迟跳转到登录页
          setTimeout(() => {
            wx.navigateBack();
          }, 1200);
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },

      fail() {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    });
  }
});

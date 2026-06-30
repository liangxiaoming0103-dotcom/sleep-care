// pages/doctors/doctors.js — 医生授权页面
const app = getApp();
const BASE_URL = app.globalData.apiBase || 'http://127.0.0.1:3000';

Page({
  data: {
    list: [],           // 已授权医生列表
    doctorPhone: '',    // 输入框中的手机号
    loading: false,     // 加载状态
    adding: false       // 添加中状态
  },

  onShow() {
    this.loadList();
  },

  // ========== 加载列表 ==========
  loadList() {
    const token = app.getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/doctor/granted`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ list: res.data.data || [] });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  // ========== 添加医生 ==========
  handleAdd() {
    const phone = this.data.doctorPhone.trim();
    if (!phone) {
      wx.showToast({ title: '请输入医生手机号', icon: 'none' });
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      wx.showToast({ title: '手机号格式错误', icon: 'none' });
      return;
    }

    const token = app.getToken();
    this.setData({ adding: true });
    wx.request({
      url: `${BASE_URL}/api/doctor/grant`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      data: { doctor_phone: phone },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '授权成功', icon: 'success' });
          this.setData({ doctorPhone: '' });
          this.loadList();
        } else {
          wx.showToast({ title: res.data.message || '授权失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ adding: false });
      }
    });
  },

  // ========== 撤销授权 ==========
  handleRevoke(e) {
    const doctorId = e.currentTarget.dataset.doctorId;
    wx.showModal({
      title: '确认撤销',
      content: '撤销后该医生将无法查看您的睡眠数据',
      confirmColor: '#EF4444',
      success: (res) => {
        if (!res.confirm) return;

        const token = app.getToken();
        wx.request({
          url: `${BASE_URL}/api/doctor/revoke`,
          method: 'DELETE',
          header: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          data: { doctor_id: doctorId },
          success: (res) => {
            if (res.data.code === 0) {
              wx.showToast({ title: '撤销成功', icon: 'success' });
              this.loadList();
            } else {
              wx.showToast({ title: res.data.message || '撤销失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.showToast({ title: '网络请求失败', icon: 'none' });
          }
        });
      }
    });
  },

  // ========== 输入事件 ==========
  onPhoneInput(e) {
    this.setData({ doctorPhone: e.detail.value });
  }
});

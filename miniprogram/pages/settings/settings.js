// pages/settings/settings.js

const app = getApp();
const BASE_URL = app.globalData.apiBase || 'http://127.0.0.1:3000';

Page({
  data: {
    bedTime: '',
    wakeTime: '',
    sunriseDuration: 10,
    loading: false,
    saving: false
  },

  onLoad() {
    this.loadSettings();
  },

  /** 加载设置 */
  loadSettings() {
    const token = app.getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    this.setData({ loading: true });

    wx.request({
      url: `${BASE_URL}/api/setting/plan`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        const { code, data } = res.data;
        if (code === 0 && data) {
          this.setData({
            bedTime: data.bed_time || '23:00',
            wakeTime: data.wake_time || '07:00',
            sunriseDuration: data.sunrise_duration_minutes || 10
          });
        } else {
          wx.showToast({ title: '加载设置失败', icon: 'none' });
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

  /** 保存设置 */
  saveSettings() {
    const token = app.getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    const { bedTime, wakeTime, sunriseDuration } = this.data;
    this.setData({ saving: true });

    wx.request({
      url: `${BASE_URL}/api/setting/plan`,
      method: 'PUT',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      data: {
        bed_time: bedTime,
        wake_time: wakeTime,
        sunrise_duration_minutes: sunriseDuration
      },
      success: (res) => {
        const { code, message } = res.data;
        if (code === 0) {
          wx.showToast({ title: '保存成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        } else {
          wx.showToast({ title: message || '保存失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ saving: false });
      }
    });
  },

  /** 事件处理 */
  onBedTimeChange(e) {
    this.setData({ bedTime: e.detail.value });
  },

  onWakeTimeChange(e) {
    this.setData({ wakeTime: e.detail.value });
  },

  onSunriseChange(e) {
    this.setData({ sunriseDuration: e.detail.value });
  },

  /** 返回 */
  goBack() {
    wx.navigateBack();
  }
});

// pages/home/home.js
// 首页逻辑：获取昨日睡眠报告并展示

const BASE_URL = 'http://localhost:3000';

Page({
  data: {
    sleepData: null,
    loading: true
  },

  onLoad() {
    this.loadReport();
  },

  onShow() {
    this.loadReport();
  },

  loadReport() {
    const token = getApp().getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    this.setData({ loading: true });

    wx.request({
      url: `${BASE_URL}/api/sleep/report/daily`,
      method: 'GET',
      header: {
        'Authorization': `Bearer ${token}`
      },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ sleepData: res.data.data, loading: false });
        } else {
          wx.showToast({ title: res.data.message || '加载失败', icon: 'none' });
          this.setData({ loading: false });
          if (res.data.code === 401 || res.data.code === 403) {
            wx.redirectTo({ url: '/pages/login/login' });
          }
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
        this.setData({ loading: false });
      }
    });
  },

  onPullDownRefresh() {
    this.loadReport();
    wx.stopPullDownRefresh();
  },

  /** 跳转到睡眠分期详细页 */
  goToReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  /** 跳转到作息设置页 */
  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  /** 跳转到医生授权页 */
  goToDoctors() {
    wx.navigateTo({ url: '/pages/doctors/doctors' });
  }
});
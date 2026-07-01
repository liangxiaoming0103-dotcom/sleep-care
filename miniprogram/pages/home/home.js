// pages/home/home.js
// 首页逻辑：获取昨日睡眠报告并展示

const BASE_URL = 'http://127.0.0.1:3000';

Page({
  data: {
    sleepData: null,
    loading: true,
    hasNewNote: false,
    greeting: '',
    nickname: ''
  },

  onLoad() {
    this.setGreeting();
    this.loadNickname();
    this.loadReport();
  },

  onShow() {
    this.setGreeting();
    this.loadReport();
    this.checkDoctorNote();
  },

  /** 根据当前时间设置问候语 */
  setGreeting() {
    const hour = new Date().getHours();
    let greeting;
    if (hour >= 6 && hour < 12) {
      greeting = '早安';
    } else if (hour >= 12 && hour < 18) {
      greeting = '下午好';
    } else {
      greeting = '晚安';
    }
    this.setData({ greeting });
  },

  /** 加载用户昵称 */
  loadNickname() {
    const token = getApp().getToken();
    if (!token) return;
    wx.request({
      url: `${BASE_URL}/api/user/profile`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0 && res.data.data) {
          this.setData({ nickname: res.data.data.nickname || '用户' });
        }
      }
    });
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
    wx.switchTab({ url: '/pages/report/report' });
  },

  /** 跳转到作息设置页 */
  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  /** 检查医生是否有新建议 */
  checkDoctorNote() {
    const token = getApp().getToken();
    if (!token) return;

    wx.request({
      url: `${BASE_URL}/api/patient/note/check`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0 && res.data.data.has_note) {
          const lastRead = wx.getStorageSync('last_note_read_time');
          const updatedAt = res.data.data.updated_at;
          this.setData({ hasNewNote: !lastRead || updatedAt !== lastRead });
        } else {
          this.setData({ hasNewNote: false });
        }
      },
      fail: () => {}
    });
  },

  /** 跳转到医生授权页 */
  goToDoctors() {
    wx.navigateTo({ url: '/pages/doctors/doctors' });
  },

  /** 退出登录 */
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        wx.removeStorageSync('token');
        getApp().globalData.token = null;
        wx.showToast({ title: '已退出', icon: 'none' });
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});
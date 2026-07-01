// pages/settings/settings.js
const app = getApp();
const BASE_URL = app.globalData.apiBase || 'http://127.0.0.1:3000';

Page({
  data: {
    // 个人信息
    nickname: '',
    gender: 0,
    genderText: '未知',
    birthYear: '',
    // 作息
    bedTime: '',
    wakeTime: '',
    sunriseDuration: 10,
    loading: false,
    saving: false
  },

  onLoad() {
    setTimeout(() => {
      this.loadProfile();
      this.loadSettings();
    }, 100);
  },

  /** 加载个人信息 */
  loadProfile() {
    const token = app.getToken();
    if (!token) return;

    wx.request({
      url: `${BASE_URL}/api/user/profile`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0 && res.data.data) {
          const d = res.data.data;
          const genderMap = { 0: '未知', 1: '男', 2: '女' };
          this.setData({
            nickname: d.nickname || '',
            gender: d.gender || 0,
            genderText: genderMap[d.gender] || '未知',
            birthYear: d.birth_year || ''
          });
        }
      }
    });
  },

  /** 加载作息设置 */
  loadSettings() {
    const token = app.getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }

    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/setting/plan`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        const { code, data } = res.data;
        if (code === 0 && data) {
          this.setData({
            bedTime: data.bed_time || '23:00',
            wakeTime: data.wake_time || '07:00',
            sunriseDuration: data.sunrise_duration_minutes || 10
          });
        }
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); },
      complete: () => { this.setData({ loading: false }); }
    });
  },

  /** 保存个人信息 */
  saveProfile() {
    const token = app.getToken();
    if (!token) return;
    const { nickname, gender, birthYear } = this.data;

    wx.request({
      url: `${BASE_URL}/api/user/profile`,
      method: 'PUT',
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: {
        nickname: nickname,
        gender: gender,
        birth_year: birthYear ? parseInt(birthYear) : null
      },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '个人信息已保存', icon: 'success' });
        } else {
          wx.showToast({ title: res.data.message || '保存失败', icon: 'none' });
        }
      },
      fail: () => { wx.showToast({ title: '网络请求失败', icon: 'none' }); }
    });
  },

  /** 保存作息设置 */
  saveSettings() {
    const token = app.getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }

    const { bedTime, wakeTime, sunriseDuration } = this.data;
    this.setData({ saving: true });

    wx.request({
      url: `${BASE_URL}/api/setting/plan`,
      method: 'PUT',
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: { bed_time: bedTime, wake_time: wakeTime, sunrise_duration_minutes: sunriseDuration },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '作息已保存', icon: 'success' });
        } else {
          wx.showToast({ title: res.data.message || '保存失败', icon: 'none' });
        }
      },
      fail: () => { wx.showToast({ title: '网络请求失败', icon: 'none' }); },
      complete: () => { this.setData({ saving: false }); }
    });
  },

  // ---- 事件 ----
  onNicknameChange(e) { this.setData({ nickname: e.detail.value }); },
  onBirthYearChange(e) { this.setData({ birthYear: e.detail.value }); },
  onGenderChange(e) {
    const gender = parseInt(e.currentTarget.dataset.gender);
    const map = { 0: '未知', 1: '男', 2: '女' };
    this.setData({ gender, genderText: map[gender] });
  },
  onBedTimeChange(e) { this.setData({ bedTime: e.detail.value }); },
  onWakeTimeChange(e) { this.setData({ wakeTime: e.detail.value }); },
  onSunriseChange(e) { this.setData({ sunriseDuration: e.detail.value }); },
  goBack() { wx.navigateBack(); }
});

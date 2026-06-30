// pages/report/report.js
// 睡眠分期报告页

const BASE_URL = 'http://localhost:3000';
const WEEK = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

Page({
  data: {
    selectedDate: '',
    todayStr: '',
    dateDisplay: '',
    dateWeekday: '',
    isToday: false,
    stagesData: null,
    loading: true,
    awakeCount: 0, lightCount: 0, deepCount: 0, remCount: 0,
    awakePercent: 0, lightPercent: 0, deepPercent: 0, remPercent: 0
  },

  onLoad() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const y = new Date(); y.setDate(y.getDate() - 1);
    this.setData({ selectedDate: y.toISOString().split('T')[0], todayStr });
    this.syncDateUI();
    this.loadStages();
  },

  syncDateUI() {
    const d = new Date(this.data.selectedDate);
    const today = this.data.todayStr;
    this.setData({
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: WEEK[d.getDay()],
      isToday: this.data.selectedDate === today
    });
  },

  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value });
    this.syncDateUI();
    this.loadStages();
  },

  onPrevDay() {
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() - 1);
    this.setData({ selectedDate: d.toISOString().split('T')[0] });
    this.syncDateUI();
    this.loadStages();
  },

  onNextDay() {
    if (this.data.isToday) return;
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() + 1);
    this.setData({ selectedDate: d.toISOString().split('T')[0] });
    this.syncDateUI();
    this.loadStages();
  },

  loadStages() {
    const token = getApp().getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }
    this.setData({ loading: true });

    wx.request({
      url: `${BASE_URL}/api/sleep/stages`,
      method: 'GET',
      data: { date: this.data.selectedDate },
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          const data = res.data.data;
          this.setData({ stagesData: data, ...this.countStages(data.stages), loading: false });
        } else {
          this.setData({ stagesData: null, loading: false });
          if (res.data.code === 401 || res.data.code === 403) wx.redirectTo({ url: '/pages/login/login' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
        this.setData({ loading: false });
      }
    });
  },

  countStages(stages) {
    const total = (stages || []).length || 1;
    let a = 0, l = 0, d = 0, r = 0;
    (stages || []).forEach(s => {
      if (s === 0) a++; else if (s === 1) l++; else if (s === 2) d++; else if (s === 3) r++;
    });
    return {
      awakeCount: a, lightCount: l, deepCount: d, remCount: r,
      awakePercent: Math.round(a/total*100), lightPercent: Math.round(l/total*100),
      deepPercent: Math.round(d/total*100), remPercent: Math.round(r/total*100)
    };
  },

  onPullDownRefresh() { this.loadStages(); wx.stopPullDownRefresh(); }
});

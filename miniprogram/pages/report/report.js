// pages/report/report.js
// 睡眠分期报告页：箭头切换 + 弹窗日历（日/月/年三级）+ 睡眠分期图

const BASE_URL = 'http://localhost:3000';

Page({
  data: {
    dateStr: '',
    dateDisplay: '',
    dateWeekday: '',
    todayStr: '',
    isToday: false,
    isYesterday: false,
    stages: [],
    labels: [],
    loading: true,
    awakeCount: 0, lightCount: 0, deepCount: 0, remCount: 0,
    awakePercent: 0, lightPercent: 0, deepPercent: 0, remPercent: 0,

    // 弹窗日历
    showCalendar: false,
    calView: 'days',      // 'days' | 'months' | 'years'
    calYear: 2026,
    calMonth: 6,
    calTitle: '',
    calDays: [],
    calMonths: [],
    calYears: []
  },

  onLoad(options) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    this.setData({ todayStr });
    if (options.date) this.setData({ dateStr: options.date });
    this.syncDateUI();
    this.loadData();
  },

  /* ================================================================
     日期逻辑
     ================================================================ */
  syncDateUI() {
    const ds = this.getDateStr();
    const d = new Date(ds);
    const today = this.data.todayStr;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yStr = y.toISOString().split('T')[0];
    const weekMap = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    this.setData({
      dateStr: ds,
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: weekMap[d.getDay()],
      isToday: ds === today,
      isYesterday: ds === yStr
    });
  },

  getDateStr() {
    if (this.data.dateStr) return this.data.dateStr;
    const y = new Date(); y.setDate(y.getDate() - 1);
    return y.toISOString().split('T')[0];
  },

  onPrevDay() {
    const d = new Date(this.data.dateStr);
    d.setDate(d.getDate() - 1);
    this.setData({ dateStr: d.toISOString().split('T')[0] });
    this.syncDateUI(); this.loadData();
  },

  onNextDay() {
    if (this.data.isToday) return;
    const d = new Date(this.data.dateStr);
    d.setDate(d.getDate() + 1);
    this.setData({ dateStr: d.toISOString().split('T')[0] });
    this.syncDateUI(); this.loadData();
  },

  /* ================================================================
     弹窗日历 — 三级视图 isAll
     ================================================================ */
  onShowCalendar() {
    const d = new Date(this.data.dateStr);
    this.setData({ calYear: d.getFullYear(), calMonth: d.getMonth() + 1, calView: 'days' });
    this.buildCalDays();
    this.setData({ showCalendar: true });
  },

  onHideCalendar() { this.setData({ showCalendar: false }); },
  noop() {},

  /** 点击标题切换视图：日→月→年 */
  onCalToggleView() {
    const { calView } = this.data;
    if (calView === 'days') {
      this.buildCalMonths();
      this.setData({ calView: 'months', calTitle: `${this.data.calYear}年` });
    } else if (calView === 'months') {
      this.buildCalYears();
      this.setData({ calView: 'years', calTitle: `${this.data.calYearRange[0]} - ${this.data.calYearRange[this.data.calYearRange.length-1]}` });
    }
    // years 视图不再切换（点击年份直接选中）
  },

  /** 左右箭头：根据当前视图切换月/年 */
  onCalPrev() {
    const { calView, calYear, calMonth } = this.data;
    if (calView === 'days') {
      if (calMonth === 1) this.setData({ calYear: calYear - 1, calMonth: 12 });
      else this.setData({ calMonth: calMonth - 1 });
      this.buildCalDays();
    } else if (calView === 'months') {
      this.setData({ calYear: calYear - 1 });
      this.buildCalMonths();
    } else {
      this.setData({ calYear: calYear - 10 });
      this.buildCalYears();
    }
  },

  onCalNext() {
    const { calView, calYear, calMonth } = this.data;
    if (calView === 'days') {
      if (calMonth === 12) this.setData({ calYear: calYear + 1, calMonth: 1 });
      else this.setData({ calMonth: calMonth + 1 });
      this.buildCalDays();
    } else if (calView === 'months') {
      this.setData({ calYear: calYear + 1 });
      this.buildCalMonths();
    } else {
      this.setData({ calYear: calYear + 10 });
      this.buildCalYears();
    }
  },

  /** 日视图：选中某天（空日期/未来日期直接忽略） */
  onCalSelectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date || date > this.data.todayStr) return;
    this.setData({ dateStr: date, showCalendar: false });
    this.syncDateUI(); this.loadData();
  },

  /** 月视图：选中某月 → 切回该月的日视图 */
  onCalSelectMonth(e) {
    const month = parseInt(e.currentTarget.dataset.month);
    this.setData({ calMonth: month, calView: 'days' });
    this.buildCalDays();
  },

  /** 年视图：选中某年 → 切回该年的月视图 */
  onCalSelectYear(e) {
    const year = parseInt(e.currentTarget.dataset.year);
    this.setData({ calYear: year, calView: 'months' });
    this.buildCalMonths();
  },

  onCalGoYesterday() {
    const y = new Date(); y.setDate(y.getDate() - 1);
    this.setData({ dateStr: y.toISOString().split('T')[0], showCalendar: false });
    this.syncDateUI(); this.loadData();
  },

  /* ---- 构建日历数据 ---- */

  buildCalDays() {
    const { calYear, calMonth, dateStr, todayStr } = this.data;
    const days = [];
    const firstDay = new Date(calYear, calMonth - 1, 1);
    const lastDay = new Date(calYear, calMonth, 0);
    const startPad = firstDay.getDay();
    for (let i = 0; i < startPad; i++) days.push({ day: '', isEmpty: true, dateStr: '', isToday: false, isSelected: false, isFuture: false });
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const ds = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      days.push({ day: d, isEmpty: false, dateStr: ds, isToday: ds === todayStr, isSelected: ds === dateStr, isFuture: ds > todayStr });
    }
    this.setData({ calDays: days, calTitle: `${calYear}年 ${calMonth}月` });
  },

  buildCalMonths() {
    const { calYear, calMonth } = this.data;
    const labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const months = labels.map((label, i) => ({
      label, month: i + 1,
      isCurrent: calYear === this.data.calYear && (i + 1) === calMonth
    }));
    this.setData({ calMonths: months, calTitle: `${calYear}年` });
  },

  buildCalYears() {
    const { calYear } = this.data;
    const start = Math.floor(calYear / 10) * 10;
    const years = [];
    for (let y = start; y < start + 10; y++) {
      years.push({ year: y, isCurrent: y === calYear });
    }
    this.setData({ calYears: years, calYearRange: years.map(y => y.year), calTitle: `${start} - ${start+9}` });
  },

  /* ================================================================
     数据加载
     ================================================================ */
  loadData() {
    const token = getApp().getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }
    const dateStr = this.data.dateStr;
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/sleep/stages`,
      method: 'GET',
      data: { date: dateStr },
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          const { stages, labels } = res.data.data;
          this.setData({ stages, labels, ...this.calcStats(stages), loading: false });
        } else {
          this.setData({ stages: [], labels: [], loading: false });
          if (res.data.code === 401 || res.data.code === 403) wx.redirectTo({ url: '/pages/login/login' });
        }
      },
      fail: () => { wx.showToast({ title: '网络请求失败', icon: 'none' }); this.setData({ loading: false }); }
    });
  },

  calcStats(stages) {
    const total = stages.length || 1;
    let awakeCount = 0, lightCount = 0, deepCount = 0, remCount = 0;
    stages.forEach(s => { if (s===0) awakeCount++; else if (s===1) lightCount++; else if (s===2) deepCount++; else if (s===3) remCount++; });
    return {
      awakeCount, lightCount, deepCount, remCount,
      awakePercent: Math.round(awakeCount/total*100), lightPercent: Math.round(lightCount/total*100),
      deepPercent: Math.round(deepCount/total*100), remPercent: Math.round(remCount/total*100)
    };
  },

  onPullDownRefresh() { this.loadData(); wx.stopPullDownRefresh(); }
});

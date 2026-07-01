// pages/report/report.js
// 睡眠报告页：三视图（分期 / 噪音 / 趋势）

const BASE_URL = 'http://127.0.0.1:3000';
const WEEK = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

Page({
  data: {
    selectedDate: '',
    todayStr: '',
    dateDisplay: '',
    dateWeekday: '',
    isToday: false,
    loading: true,

    // 医生建议
    doctorName: '',
    doctorNote: '',
    doctorNoteTime: '',

    // 视图
    currentTab: 0,       // 0=分期 1=噪音 2=趋势

    // 分期
    stagesData: null,
    awakeCount: 0, lightCount: 0, deepCount: 0, remCount: 0,
    awakePercent: 0, lightPercent: 0, deepPercent: 0, remPercent: 0,

    // 噪音
    noiseData: null,
    noiseEc: {},

    // 趋势
    trendPeriod: 'day',
    trendScores: [],
    trendLabels: [],
    trendAvg: 0,
    currentPeriod: 'day',
    summaryData: null,
    summaryLoading: false,
    summaryEc: {}
  },

  onLoad() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const selectedDate = now.toISOString().split('T')[0];
    const d = new Date(selectedDate);
    this.setData({
      selectedDate, todayStr,
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: WEEK[d.getDay()],
      isToday: true
    });
    this.loadStages();
    this.loadNoise();
    this.loadTrend();
    this.loadSummary();
    this.loadDoctorNote();
  },

  onDateChange(e) {
    const selectedDate = e.detail.value;
    const d = new Date(selectedDate);
    this.setData({
      selectedDate,
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: WEEK[d.getDay()],
      isToday: selectedDate === this.data.todayStr
    });
    this.loadStages();
    this.loadNoise();
    this.loadTrend();
    this.loadSummary();
  },

  onPrevDay() {
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() - 1);
    const selectedDate = d.toISOString().split('T')[0];
    this.setData({
      selectedDate,
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: WEEK[d.getDay()],
      isToday: selectedDate === this.data.todayStr
    });
    this.loadStages();
    this.loadNoise();
    this.loadTrend();
    this.loadSummary();
  },

  onNextDay() {
    if (this.data.isToday) return;
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() + 1);
    const selectedDate = d.toISOString().split('T')[0];
    this.setData({
      selectedDate,
      dateDisplay: `${d.getMonth()+1}月${d.getDate()}日`,
      dateWeekday: WEEK[d.getDay()],
      isToday: selectedDate === this.data.todayStr
    });
    this.loadStages();
    this.loadNoise();
    this.loadTrend();
    this.loadSummary();
  },

  /* ================================================================
     视图切换
     ================================================================ */
  onSwitchTab(e) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    this.setData({ currentTab: tab });
  },

  onSwitchTrend(e) {
    const period = e.currentTarget.dataset.period;
    this.switchPeriod(period);
  },

  /** 切换趋势周期 */
  switchPeriod(period) {
    this.setData({ trendPeriod: period, currentPeriod: period });
    this.loadTrend();
    this.loadSummary();
  },

  /* ================================================================
     分期
     ================================================================ */
  loadStages() {
    const token = getApp().getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }
    const { selectedDate } = this.data;
    this.setData({ loading: true });

    wx.request({
      url: `${BASE_URL}/api/sleep/stages?date=${selectedDate}`,
      method: 'GET',
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
      fail: () => { wx.showToast({ title: '加载分期数据失败', icon: 'none' }); this.setData({ loading: false }); }
    });
  },

  /* ================================================================
     噪音
     ================================================================ */
  loadNoise() {
    const token = getApp().getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }

    wx.request({
      url: `${BASE_URL}/api/sleep/noise?date=${this.data.selectedDate}`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          const data = res.data.data;
          const arr = data.noise || [];
          const min = Math.min(...arr).toFixed(1);
          const max = Math.max(...arr).toFixed(1);
          const avg = (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(1);
          this.setData({ noiseData: { ...data, noiseMin: min, noiseMax: max, noiseAvg: avg } });
          this.updateNoiseChart();
        } else {
          this.setData({ noiseData: null });
          if (res.data.code === 401 || res.data.code === 403) wx.redirectTo({ url: '/pages/login/login' });
        }
      },
      fail: () => { wx.showToast({ title: '网络请求失败', icon: 'none' }); }
    });
  },

  initNoiseChart(canvas, width, height, dpr) {
    const echarts = require('../../components/ec-canvas/echarts');
    const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
    this.noiseChart = chart;
    this.updateNoiseChart();
    return chart;
  },

  updateNoiseChart() {
    if (!this.noiseChart) return;
    const data = this.data.noiseData;
    if (!data) return;

    const option = {
      tooltip: { trigger: 'axis', formatter: (params) => { const p = params[0]; return `${p.name}\n噪音: ${p.value} dB`; } },
      grid: { left: '5%', right: '5%', bottom: '10%', top: '10%', containLabel: true },
      xAxis: { type: 'category', data: data.labels, axisLabel: { fontSize: 10, interval: 11 } },
      yAxis: { type: 'value', min: 20, max: 80, splitLine: { show: true, lineStyle: { type: 'dashed', color: '#e8ecf0' } }, axisLabel: { fontSize: 10, formatter: (value) => value + 'dB' } },
      series: [{ type: 'line', data: data.noise, smooth: true, symbol: 'none', lineStyle: { color: '#4A90D9', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(74,144,217,0.4)' }, { offset: 1, color: 'rgba(74,144,217,0.05)' }] } } }]
    };
    this.noiseChart.setOption(option);
  },

  /* ================================================================
     趋势
     ================================================================ */
  loadTrend() {
    const token = getApp().getToken();
    if (!token) return;

    wx.request({
      url: `${BASE_URL}/api/sleep/summary?period=${this.data.trendPeriod}&date=${this.data.selectedDate}`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          const d = res.data.data;
          // 缩短月份标签：2026-01 → 26/1月
          const shortLabels = d.labels.map(l => {
            const m = l.match(/^(\d{4})-(\d{2})$/);
            return m ? `${m[1].slice(2)}/${parseInt(m[2])}月` : l;
          });
          this.setData({
            trendScores: d.scores,
            trendLabels: shortLabels,
            trendAvg: d.avg_score
          });
        }
      },
      fail: () => {}
    });
  },

  /** 加载评分汇总（独立于 CSS 趋势图） */
  loadSummary() {
    const token = getApp().getToken();
    if (!token) return;

    this.setData({ summaryLoading: true });

    wx.request({
      url: `${BASE_URL}/api/sleep/summary?period=${this.data.currentPeriod}&date=${this.data.selectedDate}`,
      method: 'GET',
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ summaryData: res.data.data, summaryLoading: false });
          this.updateSummaryChart();
        } else {
          this.setData({ summaryLoading: false });
        }
      },
      fail: () => { this.setData({ summaryLoading: false }); }
    });
  },

  /** 初始化评分趋势 ECharts 折线图 */
  initSummaryChart() {
    const ecComponent = this.selectComponent('#summary-chart');
    if (!ecComponent) return;

    const that = this;
    ecComponent.init((canvas, width, height, dpr) => {
      const echarts = require('../../components/ec-canvas/echarts');
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      that.summaryChart = chart;
      that.updateSummaryChart();
      return chart;
    });
  },

  /** 更新评分趋势图表数据 */
  updateSummaryChart() {
    if (!this.summaryChart) return;
    const data = this.data.summaryData;
    if (!data) return;

    const option = {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => `${params[0].name}\n睡眠评分: ${params[0].value}`
      },
      grid: {
        left: '5%',
        right: '5%',
        bottom: '10%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLabel: { fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        min: 40,
        max: 100,
        splitLine: {
          show: true,
          lineStyle: { type: 'dashed', color: '#e8ecf0' }
        },
        axisLabel: {
          fontSize: 10,
          formatter: (value) => value + '分'
        }
      },
      series: [{
        type: 'line',
        data: data.scores,
        smooth: false,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#4A90D9', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(74, 144, 217, 0.3)' },
              { offset: 1, color: 'rgba(74, 144, 217, 0.03)' }
            ]
          }
        },
        markLine: {
          silent: true,
          data: [{ yAxis: data.avg_score }],
          lineStyle: { color: '#e74c3c', type: 'dashed' },
          label: {
            formatter: `平均 ${data.avg_score}分`,
            color: '#e74c3c',
            fontSize: 10
          }
        }
      }]
    };

    this.summaryChart.setOption(option);
  },

  /* ================================================================
     医生建议
     ================================================================ */
  loadDoctorNote() {
    const token = getApp().getToken();
    if (!token) return;

    wx.request({
      url: `${BASE_URL}/api/patient/note/check`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0 && res.data.data.has_note) {
          const d = res.data.data;
          this.setData({
            doctorName: d.doctor_name,
            doctorNote: d.doctor_note,
            doctorNoteTime: d.updated_at ? d.updated_at.slice(0, 16).replace('T', ' ') : ''
          });
          // 标记已读
          wx.setStorageSync('last_note_read_time', d.updated_at);
        }
      },
      fail: () => {}
    });
  },

  /* ================================================================
     工具
     ================================================================ */
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

  onPullDownRefresh() { this.loadStages(); this.loadNoise(); this.loadTrend(); this.loadSummary(); wx.stopPullDownRefresh(); }
});

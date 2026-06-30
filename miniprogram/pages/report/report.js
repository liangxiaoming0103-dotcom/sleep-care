// pages/report/report.js
// 睡眠分期报告页：日期导航 + 分期图 + 噪音曲线

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
    noiseData: null,
    noiseEc: {},
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
    this.loadNoise();
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
    this.loadNoise();
  },

  onPrevDay() {
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() - 1);
    this.setData({ selectedDate: d.toISOString().split('T')[0] });
    this.syncDateUI();
    this.loadStages();
    this.loadNoise();
  },

  onNextDay() {
    if (this.data.isToday) return;
    const d = new Date(this.data.selectedDate);
    d.setDate(d.getDate() + 1);
    this.setData({ selectedDate: d.toISOString().split('T')[0] });
    this.syncDateUI();
    this.loadStages();
    this.loadNoise();
  },

  /* ================================================================
     分期数据
     ================================================================ */
  loadStages() {
    const token = getApp().getToken();
    if (!token) { wx.redirectTo({ url: '/pages/login/login' }); return; }
    const { selectedDate } = this.data;
    this.setData({ loading: true });

    wx.request({
      url: `${BASE_URL}/api/sleep/stages`,
      method: 'GET',
      data: { date: selectedDate },
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
      fail: () => { wx.showToast({ title: '分期数据加载失败', icon: 'none' }); this.setData({ loading: false }); }
    });
  },

  /* ================================================================
     噪音数据
     ================================================================ */
  loadNoise() {
    const token = getApp().getToken();
    if (!token) return;
    const { selectedDate } = this.data;

    wx.request({
      url: `${BASE_URL}/api/sleep/noise`,
      method: 'GET',
      data: { date: selectedDate },
      header: { 'Authorization': `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ noiseData: res.data.data });
        } else {
          this.setData({ noiseData: null });
        }
      },
      fail: () => { wx.showToast({ title: '噪音数据加载失败', icon: 'none' }); }
    });
  },

  /** 初始化噪音 ECharts 折线图 */
  initNoiseChart(canvas, width, height, dpr) {
    const echarts = require('../../components/ec-canvas/echarts');
    const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
    this.noiseChart = chart;

    const data = this.data.noiseData;
    if (!data) return chart;

    const option = {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0];
          return `${p.name}\n噪音: ${p.value} dB`;
        }
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
        axisLabel: {
          fontSize: 10,
          interval: 11    // 每2小时显示一个标签
        }
      },
      yAxis: {
        type: 'value',
        min: 20,
        max: 80,
        splitLine: {
          show: true,
          lineStyle: { type: 'dashed', color: '#e8ecf0' }
        },
        axisLabel: {
          fontSize: 10,
          formatter: (value) => value + 'dB'
        }
      },
      series: [{
        type: 'line',
        data: data.noise,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#4A90D9', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(74, 144, 217, 0.4)' },
              { offset: 1, color: 'rgba(74, 144, 217, 0.05)' }
            ]
          }
        }
      }]
    };

    chart.setOption(option);
    return chart;
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

  onPullDownRefresh() { this.loadStages(); this.loadNoise(); wx.stopPullDownRefresh(); }
});

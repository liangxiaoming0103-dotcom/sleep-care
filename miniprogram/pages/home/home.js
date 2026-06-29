// pages/home/home.js
// 首页逻辑：获取昨日睡眠报告并展示

const app = getApp();

Page({

  /**
   * 页面的初始数据
   */
  data: {
    loading: true,    // 加载状态
    sleepData: null   // 睡眠报告数据
  },

  /**
   * 生命周期函数--监听页面显示
   * 每次进入首页都刷新数据
   */
  onShow() {
    this.loadReport();
  },

  /**
   * 获取昨日睡眠报告
   * GET /api/sleep/report/daily（默认返回昨天的数据）
   */
  loadReport() {
    const token = app.getToken();

    // 未登录则跳转
    if (!token) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    // 显示加载状态
    this.setData({ loading: true });

    wx.request({
      url: 'http://localhost:3000/api/sleep/report/daily',
      method: 'GET',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      success: (res) => {
        if (res.data.code === 0 && res.data.data) {
          // 获取成功，设置数据
          this.setData({
            sleepData: res.data.data,
            loading: false
          });
        } else {
          // 无数据或其他业务错误
          this.setData({
            sleepData: null,
            loading: false
          });
        }
      },
      fail: () => {
        // 网络异常
        this.setData({
          sleepData: null,
          loading: false
        });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
// pages/doctors/doctors.js — 医生授权页面
const app = getApp();
const BASE_URL = app.globalData.apiBase || 'http://127.0.0.1:3000';

Page({
  data: {
    doctorList: [],        // 所有医生列表
    authList: [],          // 已授权医生列表
    selectedDoctorId: null,  // 当前选中的医生 ID
    selectedDoctorName: '',  // 当前选中的医生姓名
    selectedDoctorPhone: '', // 当前选中的医生手机号
    loading: false,        // 加载中
    adding: false,         // 授权中
    // 分页
    pageSize: 4,
    currentPage: 0,
    totalPages: 0,
    pageDoctors: []        // 当前页显示的医生
  },

  goBack() {
    wx.navigateBack();
  },

  onShow() {
    // 延迟加载，避免页面切换动画期间闪烁
    setTimeout(() => {
      this.loadDoctors();
      this.loadAuthList();
    }, 100);
  },

  // ========== 加载所有医生 ==========
  loadDoctors() {
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/users/doctors`,
      method: 'GET',
      success: (res) => {
        if (res.data.code === 0) {
          const list = res.data.data || [];
          const totalPages = Math.ceil(list.length / this.data.pageSize);
          this.setData({
            doctorList: list,
            totalPages: totalPages,
            currentPage: 0,
            pageDoctors: list.slice(0, this.data.pageSize)
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载医生列表失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  // ========== 加载已授权列表 ==========
  loadAuthList() {
    const token = app.getToken();
    if (!token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    wx.request({
      url: `${BASE_URL}/api/doctor/granted`,
      method: 'GET',
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ authList: res.data.data || [] });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      }
    });
  },

  // ========== 点击选中/取消医生 ==========
  selectDoctor(e) {
    const id = e.currentTarget.dataset.id;
    const { doctorList, selectedDoctorId } = this.data;

    // 点击已选中的 → 取消选中
    if (selectedDoctorId === id) {
      this.setData({ selectedDoctorId: null, selectedDoctorName: '', selectedDoctorPhone: '' });
      return;
    }

    // 选中新医生
    const doctor = doctorList.find(d => d.id === id);
    this.setData({
      selectedDoctorId: id,
      selectedDoctorName: doctor ? (doctor.nickname || '医生') : '',
      selectedDoctorPhone: doctor ? (doctor.phone || '') : ''
    });
  },

  // ========== 分页 ==========
  getPageData(page) {
    const { doctorList, pageSize } = this.data;
    const start = page * pageSize;
    return { pageDoctors: doctorList.slice(start, start + pageSize) };
  },

  onPrevPage() {
    if (this.data.currentPage <= 0) return;
    const page = this.data.currentPage - 1;
    this.setData({ currentPage: page, ...this.getPageData(page) });
  },

  onNextPage() {
    if (this.data.currentPage >= this.data.totalPages - 1) return;
    const page = this.data.currentPage + 1;
    this.setData({ currentPage: page, ...this.getPageData(page) });
  },

  // ========== 授权医生 ==========
  handleAdd() {
    const { selectedDoctorId } = this.data;
    if (!selectedDoctorId) {
      wx.showToast({ title: '请先选择医生', icon: 'none' });
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
      data: { doctor_id: selectedDoctorId },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '授权成功', icon: 'success' });
          this.setData({ selectedDoctorId: null, selectedDoctorName: '', selectedDoctorPhone: '' });
          this.loadAuthList();
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
              this.loadAuthList();
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
  }
});

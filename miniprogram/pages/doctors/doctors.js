// pages/doctors/doctors.js — 医生授权页面
Page({
  data: {
    doctorPhone: '',       // 输入的医生手机号
    grantedList: [],       // 已授权医生列表
    loading: false         // 加载状态
  },

  onShow() {
    this.loadGrantedList();
  },

  // 加载已授权医生列表
  loadGrantedList() {
    const token = wx.getStorageSync('token');
    if (!token) return;

    this.setData({ loading: true });
    wx.request({
      url: 'http://localhost:3000/api/doctor/granted',
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({ grantedList: res.data.data });
        }
      },
      complete: () => this.setData({ loading: false })
    });
  },

  // 输入医生手机号
  onPhoneInput(e) {
    this.setData({ doctorPhone: e.detail.value });
  },

  // 授权医生
  grantDoctor() {
    const { doctorPhone } = this.data;
    if (!doctorPhone) {
      wx.showToast({ title: '请输入医生手机号', icon: 'none' });
      return;
    }

    const token = wx.getStorageSync('token');
    wx.request({
      url: 'http://localhost:3000/api/doctor/grant',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      data: { doctor_phone: doctorPhone },
      success: (res) => {
        if (res.data.code === 0) {
          wx.showToast({ title: '授权成功', icon: 'success' });
          this.setData({ doctorPhone: '' });
          this.loadGrantedList();
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      }
    });
  },

  // 撤销授权
  revokeGrant(e) {
    const doctorId = e.currentTarget.dataset.doctorId;
    wx.showModal({
      title: '提示',
      content: '确定撤销对该医生的授权？',
      success: (modalRes) => {
        if (!modalRes.confirm) return;

        const token = wx.getStorageSync('token');
        wx.request({
          url: 'http://localhost:3000/api/doctor/revoke',
          method: 'DELETE',
          header: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          data: { doctor_id: doctorId },
          success: (res) => {
            if (res.data.code === 0) {
              wx.showToast({ title: '已撤销', icon: 'success' });
              this.loadGrantedList();
            } else {
              wx.showToast({ title: res.data.message, icon: 'none' });
            }
          }
        });
      }
    });
  }
});

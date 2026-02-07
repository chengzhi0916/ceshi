// pages/feedback/feedback.js
const app = getApp();

Page({
  data: {
    type: 0, // 0:功能建议, 1:故障报修, 2:其他
    content: '',
    deviceInfo: ''
  },

  onLoad() {
    try {
      const info = wx.getSystemInfoSync();
      const deviceStr = `${info.brand} ${info.model} (SDK:${info.SDKVersion})`;
      this.setData({ deviceInfo: deviceStr });
    } catch (e) {
    }
  },

  switchType(e) {
    this.setData({ type: parseInt(e.currentTarget.dataset.idx) });
  },

  onInputContent(e) {
    this.setData({ content: e.detail.value });
  },

  onSubmit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '写点什么吧~', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...' });

    wx.request({
      url: 'https://api.7sxbc.icu/api/feedback', 
      method: 'POST',
      data: {
        type: this.data.type,
        content: this.data.content,
        device: this.data.deviceInfo
      },
      header: {
        'content-type': 'application/json'
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.showModal({
            title: '提交成功',
            content: '感谢您的反馈！',
            showCancel: false,
            success: () => {
              this.setData({ content: '' });
              wx.navigateBack();
            }
          });
        } else {
          wx.showToast({ title: '提交失败，请重试', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '网络连接失败', icon: 'none' });
      }
    });
  }
});
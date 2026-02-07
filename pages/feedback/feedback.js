// pages/feedback/feedback.js
const app = getApp();

Page({
  data: {
    type: 0, // 0:功能建议, 1:故障报修, 2:其他
    content: '',
    deviceInfo: ''
  },

  onLoad() {
    // 自动获取设备信息（方便您排查问题）
    try {
      const info = wx.getSystemInfoSync();
      const deviceStr = `${info.brand} ${info.model} (SDK:${info.SDKVersion})`;
      this.setData({ deviceInfo: deviceStr });
    } catch (e) {
      // 忽略错误
    }
  },

  // 切换类型
  switchType(e) {
    this.setData({ type: parseInt(e.currentTarget.dataset.idx) });
  },

  // 监听输入
  onInputContent(e) {
    this.setData({ content: e.detail.value });
  },

  // 提交给您的 api.7sxbc.icu 服务器
  onSubmit() {
    // 1. 简单校验
    if (!this.data.content.trim()) {
      wx.showToast({ title: '写点什么吧~', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...' });

    // 2. 发送请求
    wx.request({
      // ⚠️⚠️⚠️ 请注意：下面这个 /api/feedback 只是我猜的！
      // 您必须问清楚您的后台，确切的接口路径是什么？
      // 例如可能是：/api/user/feedback 或 /index/submit 等
      url: 'https://api.7sxbc.icu/api/feedback', 
      
      method: 'POST', // 通常提交数据用 POST
      data: {
        type: this.data.type,      // 类型
        content: this.data.content,// 内容
        device: this.data.deviceInfo // 设备信息
        // contact: "" // 联系方式已删除，传空或者不传
      },
      header: {
        'content-type': 'application/json' // 默认值
      },
      success: (res) => {
        wx.hideLoading();
        // 假设服务器返回 code: 200 或 1 代表成功，具体看您后台定义
        if (res.statusCode === 200) {
          wx.showModal({
            title: '提交成功',
            content: '感谢您的建议！',
            showCancel: false,
            success: () => {
              this.setData({ content: '' });
              wx.navigateBack();
            }
          });
        } else {
          // 服务器收到了，但报错了
          wx.showToast({ title: '提交失败，请重试', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('请求失败', err);
        wx.showToast({ title: '网络连接失败', icon: 'none' });
      }
    });
  }
});
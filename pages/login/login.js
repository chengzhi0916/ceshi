const app = getApp();

Page({
  data: {
    userInfo: null,
    hasLogin: false,
    title: '账户中心',
    desc: '登录后可同步您的基金资产数据'
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '个人中心' });
  },

  // 页面每次显示时同步状态
  onShow() {
    this.checkLoginStatus();
  },

  checkLoginStatus() {
    const user = wx.getStorageSync('userInfo');
    const isLogin = wx.getStorageSync('isLogin');
    if (user && isLogin) {
      this.setData({
        userInfo: user,
        hasLogin: true
      });
      app.globalData.userInfo = user;
      app.globalData.isLogin = true;
    } else {
      this.setData({
        userInfo: null,
        hasLogin: false
      });
    }
  },

  // 授权登录：获取用户信息
  getUserProfile() {
    wx.getUserProfile({
      desc: '用于完善您的个人资产记录',
      success: (res) => {
        const userInfo = res.userInfo;
        // 存入缓存
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('isLogin', true);
        
        // 更新页面和全局变量
        this.setData({
          userInfo: userInfo,
          hasLogin: true
        });
        app.globalData.userInfo = userInfo;
        app.globalData.isLogin = true;

        wx.showToast({ title: '登录成功', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '已取消授权', icon: 'none' });
      }
    });
  },

  // 退出登录
  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('isLogin');
          app.globalData.userInfo = null;
          app.globalData.isLogin = false;
          this.setData({
            userInfo: null,
            hasLogin: false
          });
          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  }
});
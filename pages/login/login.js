const app = getApp();

Page({
  data: {
    userInfo: null,
    hasLogin: false,
    title: '账户中心',
    desc: '登录后可同步您的个人数据'
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '个人中心' });
  },

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

  getUserProfile() {
    wx.getUserProfile({
      desc: '用于完善您的个人记录',
      success: (res) => {
        const userInfo = res.userInfo;
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('isLogin', true);
        
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
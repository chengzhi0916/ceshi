const API_BASE = 'https://api.7sxbc.icu/api/valuation';

Page({
  data: {
    currentTab: 0, 
    myFunds: [],
    countdown: 30,
    timer: null,
    showModal: false,
    lastUpdateTime: '',
    userInfo: null,
    isLogin: false,
    isRefreshing: false,
    form: { code: '', name: '', amount: '', cost: '', shares: '' }
  },

  onShow() {
    const user = wx.getStorageSync('userInfo');
    const login = wx.getStorageSync('isLogin');
    this.setData({ userInfo: user, isLogin: login });
    
    const storedFunds = wx.getStorageSync('my_funds') || [];
    this.setData({ myFunds: storedFunds });
    
    if (storedFunds.length > 0) this.refreshAll();
    this.startTimer();
  },

  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); },

  startTimer() {
    this.stopTimer();
    this.setData({ countdown: 30 });
    this.data.timer = setInterval(() => {
      if (this.data.countdown > 0) {
        this.setData({ countdown: this.data.countdown - 1 });
      } else {
        this.refreshAll();
      }
    }, 1000);
  },

  stopTimer() {
    if (this.data.timer) {
      clearInterval(this.data.timer);
      this.data.timer = null;
    }
  },

  async fetchFundValuation(fundCode) {
    try {
      const response = await wx.request({
        url: `${API_BASE}?code=${fundCode}&t=${Date.now()}`,
        success: (res) => {
          if (res.data.code === 200) {
            const fundData = res.data.data;
            const lastNav = parseFloat(fundData.last_nav);
            const estNav = parseFloat(fundData.est_nav);
            const changeRate = ((estNav - lastNav) / lastNav * 100).toFixed(2);

            const isPositive = changeRate >= 0;
            
            this.setData({
              'myFunds[0].estNav': fundData.est_nav,
              'myFunds[0].changeRate': changeRate,
              'myFunds[0].isPositive': isPositive,
              'myFunds[0].time': fundData.update_time
            });
          }
        },
        fail: (error) => {
        }
      });
    } catch (error) {
    }
  },

  refreshAll() {
    if (this.data.isRefreshing || this.data.myFunds.length === 0) return;
    this.setData({ isRefreshing: true });

    const funds = this.data.myFunds;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const promises = funds.map((fund, index) => {
      return new Promise((resolve) => {
        this.fetchFundValuation(fund.code);
        resolve();
      });
    });

    Promise.all(promises).then(() => {
      this.setData({ 
        lastUpdateTime: timeStr, 
        countdown: 30,
        isRefreshing: false 
      });
    });
  },

  switchTab(e) { 
    const idx = Number(e.currentTarget.dataset.idx); 
    this.setData({ currentTab: idx }); 
    if (idx === 0) this.refreshAll(); 
  },
  
  onOpenModal() { 
    this.setData({ showModal: true, form: { code: '', name: '', amount: '', cost: '', shares: '' } }); 
  },

  onCloseModal() { 
    this.setData({ showModal: false }); 
  },
  
  onOpenDetail(e) { 
    wx.navigateTo({ url: `/pages/detail/detail?code=${e.currentTarget.dataset.code}` }); 
  },
  
  onRemoveFund(e) {
    const index = e.currentTarget.dataset.index;
    const newList = [...this.data.myFunds];
    newList.splice(index, 1);
    this.setData({ myFunds: newList });
    wx.setStorageSync('my_funds', newList);
  },
  
  onModalInputCode(e) { 
    this.setData({ 'form.code': e.detail.value }); 
  },
  
  onInputAmount(e) { 
    this.setData({ 'form.amount': e.detail.value }); 
    this.calcShares(); 
  },
  
  onInputCost(e) { 
    this.setData({ 'form.cost': e.detail.value }); 
    this.calcShares(); 
  },
  
  calcShares() { 
    const { amount, cost } = this.data.form; 
    if (amount && cost && parseFloat(cost) > 0) { 
      const s = (parseFloat(amount) / parseFloat(cost)).toFixed(2); 
      this.setData({ 'form.shares': s }); 
    } 
  },
  
  onCheckProduct() { 
    const code = this.data.form.code;
    if (code.length !== 6) return wx.showToast({ title: '请输入6位代码', icon: 'none' });
    wx.showLoading({ title: '查询中...' });
    wx.request({
      url: `${API_BASE}?code=${code}`,
      success: (res) => {
        wx.hideLoading();
        if (res.data.code === 200) {
          const d = res.data.data;
          const autoPrice = (d.est_nav && d.est_nav != 0 && d.est_nav !== '--') ? d.est_nav : d.last_nav;
          this.setData({ 'form.name': d.name, 'form.cost': autoPrice || '' });
          this.calcShares(); 
        } else {
          wx.showToast({ title: '未找到', icon: 'none' });
        }
      },
      fail: () => { wx.hideLoading(); }
    });
  },
  
  onConfirmAdd() {
    // 未登录时弹窗，点「登录」即本地标记为已登录，不调微信授权
    if (!this.data.isLogin) {
      wx.showModal({
        title: '登录验证',
        content: '请先登录后再添加',
        confirmText: '登录',
        success: (res) => {
          if (res.confirm) {
            wx.setStorageSync('hasLogin', true);
            wx.setStorageSync('isLogin', true);
            this.setData({ isLogin: true });
            this._doConfirmAdd();
          }
        }
      });
      return;
    }
    this._doConfirmAdd();
  },

  _doConfirmAdd() {
    const { code, name, cost, shares, amount } = this.data.form;
    if (!name) return wx.showToast({ title: '请先查询', icon: 'none' });
    if (this.data.myFunds.length >= 5) return wx.showToast({ title: '最多5个', icon: 'none' });
    let initialDisplay = amount || '--';
    if (!amount && shares && cost) initialDisplay = (parseFloat(shares) * parseFloat(cost)).toFixed(2);
    const newFund = { code, name, costPrice: cost || 0, shares: shares || 0, hasCost: !!cost, estNav: initialDisplay, userRate: 0, time: '获取中...', lastNav: '--', lastDate: '--' };
    const newList = [newFund, ...this.data.myFunds];
    this.setData({ myFunds: newList, showModal: false });
    wx.setStorageSync('my_funds', newList);
    this.refreshAll();
    wx.showToast({ title: '添加成功' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 1. 先清除登录相关的本地存储数据
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('isLogin');
          wx.removeStorageSync('hasLogin');
          // 2. 重置页面数据
          this.setData({ 
            isLogin: false, 
            userInfo: null, 
            currentTab: 0 
          });
          // 3. 显示成功提示
          wx.showToast({ title: '已退出登录', icon: 'success', duration: 1500 });
        }
      }
    });
  }
});

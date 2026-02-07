import * as echarts from '../../ec-canvas/echarts';

const API_BASE = 'https://api.7sxbc.icu/api'; 
const REFRESH_INTERVAL = 3000;
const MAX_POINTS = 30;

Page({
  data: {
    // 页面显示的数值
    fundName: '--',
    fundCode: '--',
    currentValue: '--',
    rate: '--',
    myShares: 0, 
    myCost: 0,
    totalDiff: '--',
    totalAmt: '--',
    isPositive: false,
    
    ec: {
      lazyLoad: true 
    }
  },

  chart: null,
  timer: null,
  
  // 核心数据
  xData: [], 
  yData: [], 
  isChartActive: false, // 🔥 新增标记：图表是否已经开始“跳动”

  onLoad: function (options) {
    const code = options.code;
    this.setData({ fundCode: code });
    
    wx.setNavigationBarTitle({ title: '数据分析' });

    this.initChartComponent();
    this.syncDataFromIndex(code);
    this.fetchData(code);
    this.startTimer(code);
  },

  onUnload() { this.stopTimer(); },
  onHide() { this.stopTimer(); },
  onShow() {
    if (this.chart && this.data.fundCode !== '--') {
      this.startTimer(this.data.fundCode);
    }
  },

  fetchData(code) {
    wx.request({
      url: `${API_BASE}/valuation`,
      data: { code },
      success: (res) => {
        if (res.data.code === 200 && res.data.data) {
          const d = res.data.data;
          this.setData({ 
            fundName: d.name || this.data.fundName,
            rate: d.est_rate || '--'
          });
          
          if (d.est_nav) {
            this.calcProfit(d.est_nav);
            
            // 提取时间 HH:mm
            let timeStr = '--';
            if (d.update_time) {
              const parts = d.update_time.split(' ');
              if (parts.length > 1) timeStr = parts[1].substring(0, 5);
            }
            
            // 只有当时间有效时，才推入图表
            if (timeStr !== '--') {
              this.updateRollingChart(timeStr, parseFloat(d.est_nav));
            }
          }
        }
      }
    });
  },

  // --- 更新滚动图表 (核心逻辑) ---
  updateRollingChart(time, value) {
    if (!this.chart) return;
    
    // 简单的去重
    const lastTime = this.xData.length > 0 ? this.xData[this.xData.length - 1] : '';
    if (time === lastTime) return;

    // 1. 推入新数据
    this.xData.push(time);
    this.yData.push(value);

    // 2. 滑动窗口
    if (this.xData.length > MAX_POINTS) {
      this.xData.shift();
      this.yData.shift();
    }

    // 3. 激活状态判断
    // 只要有了第一个数据，就把“待机模式”关掉，进入“心电图模式”
    if (!this.isChartActive) {
      this.isChartActive = true; 
    }

    // 4. 计算 Y 轴范围 (动态)
    const minVal = Math.min(...this.yData);
    const maxVal = Math.max(...this.yData);
    const padding = (maxVal - minVal) * 0.2; 
    const safePadding = padding === 0 ? maxVal * 0.01 : padding;

    // 5. 更新图表配置
    this.chart.setOption({
      xAxis: {
        data: this.xData // 只有这里有数据了，X轴才会显示时间
      },
      yAxis: {
        // 🔥 关键：只要数据进来了，就取消固定的 min/max，改为自动缩放
        min: (minVal - safePadding).toFixed(4),
        max: (maxVal + safePadding).toFixed(4)
      },
      series: [{
        data: this.yData
      }]
    });
  },

  calcProfit(currentPrice) {
    const price = parseFloat(currentPrice);
    if (isNaN(price)) return;
    const { myShares, myCost } = this.data;
    let diff = 0, amt = 0;
    this.setData({ currentValue: price.toFixed(4) });
    if (myShares > 0) {
      amt = price * myShares;
      if (myCost > 0) diff = (price - myCost) * myShares;
      this.setData({
        totalDiff: (diff > 0 ? '+' : '') + diff.toFixed(2),
        totalAmt: amt.toFixed(2),
        isPositive: diff >= 0
      });
    }
  },

  initChartComponent() {
    this.selectComponent('#mychart-dom-line').init((canvas, width, height, dpr) => {
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      this.chart = chart;

      const initOption = {
        grid: { left: '12%', right: '5%', bottom: '10%', top: '10%', containLabel: false },
        tooltip: { 
          trigger: 'axis',
          formatter: (params) => {
            const item = params[0];
            return item.value ? `${item.name}\n读数: ${item.value}` : '';
          }
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: [],
          axisLine: { lineStyle: { color: '#eee' } },
          axisLabel: { color: '#999', fontSize: 10 },
          axisTick: { show: false }
        },
        yAxis: {
          type: 'value',
          scale: true,
          min: -1, 
          max: 1,  
          splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } },
          axisLabel: { color: '#999', fontSize: 10, formatter: (v) => v.toFixed(2) }
        },
        series: [{
          type: 'line',
          smooth: true,
          symbol: 'none', 
          lineStyle: { width: 2, color: '#e54d42' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(229, 77, 66, 0.15)' },
              { offset: 1, color: 'rgba(255, 255, 255, 0)' }
            ])
          },
          data: [] // 初始没有线
        }]
      };

      chart.setOption(initOption);
      return chart;
    });
  },

  startTimer(code) {
    this.stopTimer();
    this.timer = setInterval(() => this.fetchData(code), REFRESH_INTERVAL);
  },
  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },
  syncDataFromIndex(code) {
    const pages = getCurrentPages();
    const indexPage = pages[pages.length - 2];
    if (indexPage && indexPage.data.myFunds) {
      const item = indexPage.data.myFunds.find(i => String(i.code) === String(code));
      if (item) {
        this.setData({
          fundName: item.name,
          myShares: parseFloat(item.shares) || 0,
          myCost: parseFloat(item.costPrice) || 0
        });
      }
    }
  }
});
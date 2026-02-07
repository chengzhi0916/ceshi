import * as echarts from '../../ec-canvas/echarts';

const API_BASE = 'https://api.7sxbc.icu/api';
const REFRESH_INTERVAL = 3000;
const MAX_POINTS = 30;

Page({
  data: {
    fundName: '--',
    fundCode: '--',
    currentValue: '--',
    rate: '--',
    myShares: 0,
    myCost: 0,
    totalDiff: '--',
    totalAmt: '--',
    ec: { lazyLoad: true }
  },

  // 内部状态（非 data）
  xData: [],
  yData: [],
  chart: null,
  timer: null,
  realTimeTimer: null,
  isChartActive: false,

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '数据分析' });
    const code = options && options.code ? options.code : this.data.fundCode;
    if (code) this.setData({ fundCode: code });

    // 先从 index 同步用户持仓信息
    this.syncDataFromIndex(code);

    // 初始化图表（ec: lazyLoad 为 true，主动 init）
    this.initChartComponent();

    // 加载历史数据并启动实时更新与轮询
    if (code) {
      this.loadHistoryData(code);
      this.startRealTimeUpdate(code);
      this.fetchData(code);
      this.startTimer(code);
    }
  },

  // 将后端的时间字符串转换为本地 HH:mm（兼容 YYYY-MM-DD HH:mm:ss）
  formatTimeLocal(timeStr) {
    if (!timeStr) return '--';
    try {
      const iso = timeStr.replace(' ', 'T');
      const dt = new Date(iso);
      if (isNaN(dt.getTime())) return (timeStr.split(' ')[1] || '--').substring(0,5);
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    } catch (e) {
      return (timeStr.split(' ')[1] || '--').substring(0,5);
    }
  },

  onShow() {
    if (this.data.fundCode && this.chart) {
      this.startTimer(this.data.fundCode);
      this.startRealTimeUpdate(this.data.fundCode);
    }
  },
  onHide() {
    this.stopTimer();
    if (this.realTimeTimer) { clearInterval(this.realTimeTimer); this.realTimeTimer = null; }
  },
  onUnload() { this.onHide(); },

  // 从后端加载历史点（转为百分比）
  loadHistoryData(code) {
    if (!code) return;
    wx.request({
      url: `${API_BASE}/history`,
      data: { code },
      success: (res) => {
        if (res.data && res.data.code === 200 && Array.isArray(res.data.data)) {
          const historyData = res.data.data;
          historyData.forEach(item => {
            const t = item.time_str || this.formatTimeLocal(item.update_time);
            this.xData.push(t);
            const lastNav = parseFloat(item.last_nav) || 1.0;
            const estNav = parseFloat(item.est_nav) || lastNav;
            const ratio = ((estNav - lastNav) / lastNav * 100);
            this.yData.push(parseFloat(ratio.toFixed(2)));
          });
          if (this.xData.length > 0) {
            this.isChartActive = true;
            this.updateChart();
          }
        }
      }
    });
  },

  startRealTimeUpdate(code) {
    if (!code) return;
    if (this.realTimeTimer) clearInterval(this.realTimeTimer);
    this.realTimeTimer = setInterval(() => this.fetchRealTimeData(code), REFRESH_INTERVAL);
  },

  fetchRealTimeData(code) {
    if (!code) return;
    wx.request({
      url: `${API_BASE}/valuation`,
      data: { code, t: Date.now() },
      success: (res) => {
        if (res.data && res.data.code === 200 && res.data.data) {
          const data = res.data.data;
          this.setData({ fundName: data.name || this.data.fundName });
          if (data.update_time) {
            const timeStr = this.formatTimeLocal(data.update_time);
            const lastNav = parseFloat(data.last_nav) || 1.0;
            const estNavValue = parseFloat(data.est_nav) || lastNav;
            const changeRate = ((estNavValue - lastNav) / lastNav * 100);
            this.addChartPoint(timeStr, parseFloat(changeRate.toFixed(2)));
            this.calcProfit(estNavValue);
            this.setData({ rate: (changeRate.toFixed(2)) });
          }
        }
      }
    });
  },

  // 添加点并触发图表更新（去重 + 滑动窗口）
  addChartPoint(time, value) {
    const lastTime = this.xData.length > 0 ? this.xData[this.xData.length -1] : '';
    if (time === lastTime) return;
    this.xData.push(time);
    this.yData.push(value);
    if (this.xData.length > MAX_POINTS) {
      this.xData.shift();
      this.yData.shift();
    }
    if (!this.isChartActive) this.isChartActive = true;
    this.updateChart();
  },

  updateChart() {
    if (!this.chart) return;
    if (this.yData.length === 0) {
      this.chart.setOption({ xAxis: { data: [] }, series: [{ data: [] }] });
      return;
    }

    const minVal = Math.min(...this.yData);
    const maxVal = Math.max(...this.yData);
    const padding = (Math.abs(maxVal - minVal)) * 0.3;
    const safePadding = padding === 0 ? Math.abs(maxVal) * 0.1 : padding;
    const yAxisMin = parseFloat((minVal - safePadding).toFixed(4));
    const yAxisMax = parseFloat((maxVal + safePadding).toFixed(4));

    this.chart.setOption({
      xAxis: { data: this.xData, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', min: yAxisMin, max: yAxisMax, splitLine: { lineStyle: { type: 'dashed' } }, axisLabel: { formatter: (v) => v.toFixed(2) + '%' } },
      series: [{ data: this.yData }]
    });
  },

  fetchData(code) {
    if (!code) return;
    wx.request({
      url: `${API_BASE}/valuation`,
      data: { code },
      success: (res) => {
        if (res.data && res.data.code === 200 && res.data.data) {
          const d = res.data.data;
          this.setData({ fundName: d.name || this.data.fundName, rate: d.est_rate || '--' });
          if (d.est_nav && d.update_time) {
            const timeStr = this.formatTimeLocal(d.update_time);
            // 如果后端提供了 last_nav，则以百分比加入图表；否则保持不加入
            const lastNav = parseFloat(d.last_nav);
            if (!isNaN(lastNav) && lastNav > 0) {
              const change = ((parseFloat(d.est_nav) - lastNav) / lastNav * 100);
              this.addChartPoint(timeStr, parseFloat(change.toFixed(2)));
            } else {
              // 兜底：如果没有 last_nav，仍可将原始 est_nav 推入（仅在需要时）
              this.updateRollingChart(timeStr, parseFloat(d.est_nav));
            }
          }
        }
      }
    });
  },

  // 兼容旧逻辑：以原始数值推滚动图（如果需要保留）
  updateRollingChart(time, value) {
    if (!this.chart) return;
    const lastTime = this.xData.length > 0 ? this.xData[this.xData.length -1] : '';
    if (time === lastTime) return;
    this.xData.push(time);
    this.yData.push(value);
    if (this.xData.length > MAX_POINTS) {
      this.xData.shift();
      this.yData.shift();
    }
    if (!this.isChartActive) this.isChartActive = true;
    // 自动缩放
    const minVal = Math.min(...this.yData);
    const maxVal = Math.max(...this.yData);
    const padding = (maxVal - minVal) * 0.2;
    const safePadding = padding === 0 ? Math.abs(maxVal) * 0.01 : padding;
    this.chart.setOption({ xAxis: { data: this.xData }, yAxis: { min: parseFloat((minVal - safePadding).toFixed(4)), max: parseFloat((maxVal + safePadding).toFixed(4)) }, series: [{ data: this.yData }] });
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
      this.setData({ totalDiff: (diff > 0 ? '+' : '') + diff.toFixed(2), totalAmt: amt.toFixed(2), isPositive: diff >= 0 });
    }
  },

  initChartComponent() {
    const comp = this.selectComponent('#mychart-dom-line');
    if (!comp) return;
    comp.init((canvas, width, height, dpr) => {
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      this.chart = chart;
      const initOption = {
        grid: { left: '12%', right: '5%', bottom: '10%', top: '10%', containLabel: false },
        tooltip: { trigger: 'axis', formatter: (params) => { const item = params[0]; return item && item.value ? `${item.name}\n读数: ${item.value}%` : ''; } },
        xAxis: { type: 'category', boundaryGap: false, data: [], axisLine: { lineStyle: { color: '#eee' } }, axisLabel: { color: '#999', fontSize: 10 }, axisTick: { show: false } },
        yAxis: { type: 'value', scale: true, min: -1, max: 1, splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } }, axisLabel: { color: '#999', fontSize: 10, formatter: (v) => v.toFixed(2) } },
        series: [{ type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2, color: '#e54d42' }, areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(229,77,66,0.15)'},{offset:1,color:'rgba(255,255,255,0)'}]) }, data: [] }]
      };
      chart.setOption(initOption);
      return chart;
    });
  },

  startTimer(code) {
    this.stopTimer();
    if (!code) return;
    this.timer = setInterval(() => this.fetchData(code), REFRESH_INTERVAL);
  },
  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  syncDataFromIndex(code) {
    const pages = getCurrentPages();
    const indexPage = pages[pages.length - 2];
    if (indexPage && indexPage.data && indexPage.data.myFunds) {
      const item = indexPage.data.myFunds.find(i => String(i.code) === String(code));
      if (item) {
        this.setData({ fundName: item.name, myShares: parseFloat(item.shares) || 0, myCost: parseFloat(item.costPrice) || 0 });
      }
    }
  }
});
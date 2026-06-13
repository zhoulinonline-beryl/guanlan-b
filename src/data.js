const sectorSeeds = [
  ["半导体", 1742.36, 2.86, ["先进封装", "存储", "设备国产化"], 92],
  ["机器人", 1288.44, 2.41, ["减速器", "传感器", "具身智能"], 88],
  ["低空经济", 1164.28, 1.97, ["eVTOL", "空管", "材料"], 83],
  ["算力租赁", 1546.92, 1.62, ["液冷", "IDC", "国产算力"], 79],
  ["创新药", 932.67, 1.19, ["出海", "ADC", "临床催化"], 70],
  ["证券", 846.21, 0.82, ["活跃资本市场", "并购", "财富管理"], 63],
  ["新能源车", 1098.04, 0.45, ["固态电池", "零部件", "智能驾驶"], 58],
  ["白酒", 781.92, -0.36, ["估值修复", "渠道库存", "高端消费"], 44],
  ["煤炭", 653.87, -0.61, ["高股息", "电煤", "焦煤"], 39],
  ["房地产", 512.34, -1.08, ["政策博弈", "城中村", "物业"], 31],
  ["银行", 711.25, -0.18, ["红利", "息差", "资产质量"], 47],
  ["军工", 1006.8, 0.94, ["卫星", "航空发动机", "订单恢复"], 66]
];

const stockNames = {
  "半导体": ["中芯国际", "北方华创", "寒武纪", "华海清科", "兆易创新", "长电科技", "韦尔股份", "沪硅产业", "芯源微", "通富微电"],
  "机器人": ["埃斯顿", "汇川技术", "绿的谐波", "中大力德", "鸣志电器", "机器人", "拓斯达", "柯力传感", "双环传动", "步科股份"],
  "低空经济": ["宗申动力", "万丰奥威", "中信海直", "航天彩虹", "纵横股份", "莱斯信息", "光洋股份", "深城交", "海特高新", "广联航空"],
  "算力租赁": ["工业富联", "中际旭创", "新易盛", "浪潮信息", "润泽科技", "紫光股份", "光环新网", "数据港", "科华数据", "奥飞数据"],
  "创新药": ["恒瑞医药", "百济神州", "药明康德", "康方生物", "贝达药业", "君实生物", "信立泰", "科伦药业", "荣昌生物", "迈威生物"],
  "证券": ["中信证券", "东方财富", "华泰证券", "国泰君安", "招商证券", "广发证券", "海通证券", "财通证券", "浙商证券", "首创证券"],
  "新能源车": ["比亚迪", "宁德时代", "赛力斯", "拓普集团", "德赛西威", "伯特利", "华阳集团", "均胜电子", "三花智控", "星源材质"],
  "白酒": ["贵州茅台", "五粮液", "泸州老窖", "山西汾酒", "洋河股份", "古井贡酒", "今世缘", "舍得酒业", "酒鬼酒", "水井坊"],
  "煤炭": ["中国神华", "陕西煤业", "兖矿能源", "中煤能源", "山煤国际", "潞安环能", "平煤股份", "淮北矿业", "华阳股份", "电投能源"],
  "房地产": ["万科A", "保利发展", "招商蛇口", "滨江集团", "金地集团", "华发股份", "城建发展", "新城控股", "绿地控股", "张江高科"],
  "银行": ["招商银行", "宁波银行", "工商银行", "建设银行", "农业银行", "江苏银行", "成都银行", "杭州银行", "常熟银行", "兴业银行"],
  "军工": ["中航沈飞", "航发动力", "中航西飞", "光启技术", "航天电器", "中无人机", "内蒙一机", "火炬电子", "振华科技", "菲利华"]
};

function pseudo(seed) {
  const x = Math.sin(seed * 999.13) * 10000;
  return x - Math.floor(x);
}

function makeSeries(base, pct, score, seed) {
  const days = 34;
  const rows = [];
  let close = base;
  for (let i = 0; i < days; i += 1) {
    const pressure = i > days - 6 ? pct / 100 / 4 : (score - 50) / 10000;
    const noise = (pseudo(seed + i * 3.7) - 0.48) * 0.028;
    const change = pressure + noise;
    const open = close * (1 + (pseudo(seed + i * 2.1) - 0.5) * 0.014);
    close = Math.max(2, close * (1 + change));
    const high = Math.max(open, close) * (1 + pseudo(seed + i * 4.4) * 0.018);
    const low = Math.min(open, close) * (1 - pseudo(seed + i * 5.8) * 0.018);
    const volumeBoost = i > days - 6 ? 1 + score / 120 : 1;
    const volume = Math.round((45 + pseudo(seed + i) * 60) * volumeBoost * 10000);
    rows.push({ day: `D-${days - i - 1}`, open, high, low, close, volume });
  }
  return rows;
}

function makeStocks(sector, sIndex) {
  return stockNames[sector.name].map((name, i) => {
    const code = `${i % 2 ? "00" : "60"}${String(1000 + sIndex * 37 + i * 11).slice(-4)}`;
    const drift = sector.pct + (pseudo(sIndex * 23 + i) - 0.35) * 4;
    const score = Math.max(35, Math.min(98, sector.attackScore + (pseudo(i * 17 + sIndex) - 0.52) * 18 - i * 1.6));
    const base = 10 + pseudo(i * 13 + sIndex) * 85;
    const candles = makeSeries(base, drift, score, sIndex * 100 + i * 11);
    const last = candles.at(-1);
    const prev = candles.at(-2);
    const turnover = 4 + pseudo(i * 8 + sIndex) * 16 + score / 18;
    const mainFlow = (score - 50) * 0.28 + pseudo(i + 2) * 7;
    return {
      name,
      code,
      sector: sector.name,
      price: last.close,
      pct: ((last.close - prev.close) / prev.close) * 100,
      turnover,
      mainFlow,
      score,
      candles
    };
  }).sort((a, b) => b.score - a.score);
}

export const sectors = sectorSeeds.map(([name, index, pct, themes, attackScore], sIndex) => {
  const history = makeSeries(index, pct, attackScore, sIndex + 7).map((item) => item.close);
  const sector = { id: `sector-${sIndex}`, name, index, pct, themes, attackScore, history };
  sector.stocks = makeStocks(sector, sIndex);
  return sector;
});

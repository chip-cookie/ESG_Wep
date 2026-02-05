import React, { useState, useEffect, useRef, useMemo } from 'react';
import type {
  TabType, MarketType, IntensityType, TimeRangeType,
  TrendData, Tranche, ChatMessage, CompanyConfig
} from './types';
import { MARKET_DATA, competitors, industryBenchmarks, MOCK_COMPANIES } from './data/mockData';
import { Header } from './components/layout/Header';
import { DashboardTab } from './features/대시보드/DashboardTab';
import { CompareTab } from './features/경쟁사비교/CompareTab';
import { SimulatorTab } from './features/시뮬레이터/SimulatorTab';
import { TargetTab } from './features/목표설정/TargetTab';
import { InvestmentTab } from './features/투자계획/InvestmentTab';
import { ChatBot } from './features/챗봇/ChatBot';

const App: React.FC = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [intensityType, setIntensityType] = useState<IntensityType>('revenue');
  const [activeScopes, setActiveScopes] = useState({ s1: true, s2: true, s3: false });

  // Simulator State
  const [selectedMarket, setSelectedMarket] = useState<MarketType>('K-ETS');
  const [timeRange, setTimeRange] = useState<TimeRangeType>('1년');
  const [tranches, setTranches] = useState<Tranche[]>([
    { id: 1, market: 'K-ETS', price: 15200, month: '25.10', isFuture: false, percentage: 30 },
    { id: 2, market: 'EU-ETS', price: 74.20, month: '26.01', isFuture: false, percentage: 50 },
  ]);

  const [fullHistoryData, setFullHistoryData] = useState<TrendData[]>([]);

  const [simBudget, setSimBudget] = useState<number>(75);
  const [simRisk, setSimRisk] = useState<number>(25);
  const [activeMarkets] = useState<MarketType[]>(['K-ETS', 'EU-ETS']);

  // Investment State
  const [investTotalAmount, setInvestTotalAmount] = useState<number>(762100000000);
  const [investCarbonPrice, setInvestCarbonPrice] = useState<number>(45000);

  const [investEnergySavings, setInvestEnergySavings] = useState<number>(12.5);
  const [investDiscountRate, setInvestDiscountRate] = useState<number>(4.2);
  const [investTimeline, setInvestTimeline] = useState<number>(5);

  const [selectedCompId, setSelectedCompId] = useState<number>(1);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: '탄소 경영 대시보드에 오신 것을 환영합니다. 무엇을 도와드릴까요?' }
  ]);
  const [inputMessage, setInputMessage] = useState<string>('');

  // UI State
  const [isInsightOpen, setIsInsightOpen] = useState<boolean>(true);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Effects: Fetch Market Data from API ---
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        // 백엔드 API 호출 (3년치 전체 데이터)
        const res = await fetch('http://localhost:8000/api/v1/sim/dashboard/market-trends?period=all');
        const json = await res.json();

        if (json.chart_data && json.chart_data.length > 0) {
          // API 데이터 형식: { date, euPrice, krPrice }
          setFullHistoryData(json.chart_data);
          console.log('[System] Market data loaded from API:', json.chart_data.length, 'rows');
        } else {
          console.warn('[System] API returned empty data, using fallback.');
          // Fallback: 간단한 Mock 데이터 생성
          const fallbackData: TrendData[] = [];
          const startDate = new Date('2023-01-01');
          const endDate = new Date();
          let krPrice = 15450;
          let euPrice = 74.50;
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            if (d.getDay() === 0 || d.getDay() === 6) continue;
            krPrice += (Math.random() - 0.5) * 200;
            euPrice += (Math.random() - 0.5) * 1.0;
            fallbackData.push({
              date: d.toISOString().split('T')[0],
              krPrice: Math.round(Math.max(8000, Math.min(20000, krPrice))),
              euPrice: Number(Math.max(50, Math.min(100, euPrice)).toFixed(2))
            });
          }
          setFullHistoryData(fallbackData);
        }
      } catch (err) {
        console.error('[System] Failed to fetch market data:', err);
      }
    };

    fetchMarketData();
  }, []);

  const trendData = useMemo<any[]>(() => {
    if (fullHistoryData.length === 0) return [];

    let filtered = [...fullHistoryData];
    const todayIndex = filtered.findIndex(d => d.type === 'forecast');

    const splitIndex = todayIndex === -1 ? filtered.length - 30 : todayIndex;

    if (timeRange === '1개월') {
      const start = Math.max(0, splitIndex - 22);
      const end = Math.min(filtered.length, splitIndex + 22);
      filtered = filtered.slice(start, end);
    } else if (timeRange === '3개월') {
      const start = Math.max(0, splitIndex - 66);
      const end = Math.min(filtered.length, splitIndex + 66);
      filtered = filtered.slice(start, end);
    } else if (timeRange === '1년') {
      const start = Math.max(0, splitIndex - 250);
      const end = Math.min(filtered.length, splitIndex + 125);
      filtered = filtered.slice(start, end);

      return filtered.filter((_, i) => i % 5 === 0);
    } else if (timeRange === '전체') {
      return filtered.filter((_, i) => i % 10 === 0);
    }

    return filtered;
  }, [timeRange, fullHistoryData]);

  // --- Calculations ---
  // [MODIFY] Use MOCK_COMPANIES for selection, map to Competitor structure if needed or use as is if types overlap sufficiently (they don't quite).
  // We'll prioritize MOCK_COMPANIES for the selected entity.
  const selectedConfig = useMemo(() => MOCK_COMPANIES.find(c => c.id === selectedCompId) || MOCK_COMPANIES[0], [selectedCompId]);

  const selectedComp = useMemo(() => { // Explicitly typed in imported types, but let TS infer for now
    // Merge Config with Competitor defaults or find matching competitor data
    // For now, we'll construct a Competitor-like object from the Config
    return {
      id: selectedConfig.id,
      name: selectedConfig.name,
      s1: selectedConfig.s1,
      s2: selectedConfig.s2,
      s3: selectedConfig.s3,
      allowance: selectedConfig.allowance,
      revenue: selectedConfig.revenue,
      production: selectedConfig.production,
      trustScore: 95, // Default
      trajectory: [], // Will be filled or unused? DashboardTab uses sbtiAnalysis.trajectory, not this one directly? 
      // actually DashboardTab uses sbtiAnalysis for trajectory chart.
      // But CompareTab might use it.
      intensityValue: 0
    };
  }, [selectedConfig]);

  // Sync selectedConfig with selectedCompId logic (already done above)

  const totalExposure = useMemo(() => {
    return (activeScopes.s1 ? selectedComp.s1 : 0) +
      (activeScopes.s2 ? selectedComp.s2 : 0) +
      (activeScopes.s3 ? selectedComp.s3 : 0) -
      selectedComp.allowance;
  }, [selectedComp, activeScopes]);


  const costEU_KRW = totalExposure * MARKET_DATA['EU-ETS'].price * 1450;

  const activeTranches = tranches.filter(t => activeMarkets.includes(t.market));
  const totalAllocatedPct = activeTranches.reduce((sum, t) => sum + t.percentage, 0);

  const budgetInWon = simBudget * 100000000;
  const estimatedSavings = budgetInWon * (0.1 + (simRisk * 0.002)); // 10% ~ 30% savings based on risk

  const processIntensity = (c: any) => { // c: Competitor
    const totalE = (activeScopes.s1 ? c.s1 : 0) + (activeScopes.s2 ? c.s2 : 0) + (activeScopes.s3 ? c.s3 : 0);
    return intensityType === 'revenue' ? totalE / c.revenue : (totalE / c.production) * 1000;
  };

  const chartData = useMemo(() => {
    return competitors.map(c => ({ ...c, intensityValue: processIntensity(c) })).sort((a, b) => (a.intensityValue || 0) - (b.intensityValue || 0));
  }, [intensityType, activeScopes]);

  const topThreshold = industryBenchmarks[intensityType].top10;
  const medianThreshold = industryBenchmarks[intensityType].median;

  const ytdAnalysis = useMemo(() => {
    const targetEmissions = (activeScopes.s1 ? selectedComp.s1 : 0) + (activeScopes.s2 ? selectedComp.s2 : 0) + (activeScopes.s3 ? selectedComp.s3 : 0);
    if (targetEmissions === 0) return { currentIntensity: '0.0', percentChange: '0.0', delta: '0.0', period: '-', scopeLabel: 'None' };

    const ty_ytd = intensityType === 'revenue' ? (targetEmissions / 2) / (selectedComp.revenue / 2) : ((targetEmissions / 2) / (selectedComp.production / 2)) * 1000;
    const ly_ytd = ty_ytd * 1.095;
    const diff = ty_ytd - ly_ytd;
    const pct = (diff / ly_ytd) * 100;

    return {
      currentIntensity: ty_ytd.toFixed(1),
      percentChange: pct.toFixed(1),
      delta: diff.toFixed(1),
      period: `2026.01~06 vs 전년동기`,
      scopeLabel: [activeScopes.s1 ? 'S1' : '', activeScopes.s2 ? 'S2' : '', activeScopes.s3 ? 'S3' : ''].filter(Boolean).join('+') || 'None'
    };
  }, [selectedComp, intensityType, activeScopes]);

  const sbtiAnalysis = useMemo(() => {
    const baseYear = 2021;
    const currentYear = 2026;
    const baseEmission = 145000;
    const reductionRate = 0.042;
    const yearsElapsed = currentYear - baseYear;
    const targetReductionPct = reductionRate * yearsElapsed;
    const targetEmissionNow = baseEmission * (1 - targetReductionPct);
    const actualEmissionNow = selectedComp.s1 + selectedComp.s2;
    const actualReductionPct = (baseEmission - actualEmissionNow) / baseEmission;
    const gap = actualEmissionNow - targetEmissionNow;
    const isAhead = gap <= 0;
    const trajectory = [];
    for (let y = baseYear; y <= 2035; y++) {
      const isHistory = y <= currentYear;
      const sbtiVal = baseEmission * (1 - (y - baseYear) * reductionRate);
      let compVal = null;
      if (y === baseYear) compVal = baseEmission;
      else if (y === 2022) compVal = 145000;
      else if (y === 2023) compVal = 130000;
      else if (y === 2024) compVal = 125000;
      else if (y === 2025) compVal = 120000;
      else if (y === 2026) compVal = actualEmissionNow;
      else {
        compVal = actualEmissionNow * Math.pow(0.98, y - 2026);
      }
      trajectory.push({
        year: y.toString(),
        sbti: Math.round(sbtiVal),
        actual: Math.round(compVal),
        isHistory,
        target: Math.round(sbtiVal * 1.05),
        bau: Math.round(baseEmission * Math.pow(1.015, y - baseYear))
      });
    }
    return {
      baseYear,
      currentYear,
      baseEmission,
      targetEmissionNow,
      actualEmissionNow,
      actualReductionPct: (actualReductionPct * 100).toFixed(1),
      targetReductionPct: (targetReductionPct * 100).toFixed(1),
      gap,
      isAhead,
      trajectory
    };
  }, [selectedComp]);

  const investmentAnalysis = useMemo(() => {
    const revenue = 16730100000000;
    const totalEmissions = 250684;
    const greenInvestment = investTotalAmount;

    const annualRisk = totalEmissions * investCarbonPrice;
    const totalRiskLiability = annualRisk * investTimeline;

    const estimatedEnergyCost = revenue * 0.05;
    const annualEnergySavings = estimatedEnergyCost * (investEnergySavings / 100);
    const annualTotalBenefit = annualEnergySavings + annualRisk;

    let npv = -greenInvestment;
    let cumulativeSavings = 0;
    let paybackPeriod = 0;
    const breakEvenChartData = [];

    for (let year = 0; year <= 10; year++) {
      let savingsThisYear = 0;
      if (year > 0) {
        savingsThisYear = annualTotalBenefit / Math.pow(1 + (investDiscountRate / 100), year);
        cumulativeSavings += savingsThisYear;
        npv += savingsThisYear;

        if (cumulativeSavings >= greenInvestment && paybackPeriod === 0) {
          const prevSavings = cumulativeSavings - savingsThisYear;
          const remaining = greenInvestment - prevSavings;
          paybackPeriod = (year - 1) + (remaining / savingsThisYear);
        }
      }

      breakEvenChartData.push({
        year: `Y${year}`,
        investment: greenInvestment,
        savings: Math.round(cumulativeSavings),
      });
    }

    const roi = ((cumulativeSavings - greenInvestment) / greenInvestment) * 100;
    const isInvestFavorable = npv > 0;

    const liabilityChartData = [
      { name: 'Investment', value: greenInvestment, fill: '#10b77f' },
      { name: 'Risk Liability', value: totalRiskLiability, fill: '#94a3b8' }
    ];

    return {
      targetYear: 2030,
      totalEmissions,
      liabilityCost: totalRiskLiability,
      investmentCost: greenInvestment,
      netBenefit: npv,
      isInvestFavorable,
      roi: roi.toFixed(1),
      payback: paybackPeriod > 0 ? paybackPeriod.toFixed(1) : "> 10",
      chartData: breakEvenChartData,
      liabilityChartData,
      annualTotalBenefit
    };
  }, [investTotalAmount, investCarbonPrice, investEnergySavings, investDiscountRate, investTimeline]);

  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const point = data.activePayload[0].payload as TrendData;
      // Map selectedMarket to the correct data key
      const priceKey = selectedMarket === 'K-ETS' ? 'krPrice' : 'euPrice';
      const price = point[priceKey as keyof TrendData] as number;
      const remaining = 100 - totalAllocatedPct;
      if (remaining <= 0) return;
      const newTranche: Tranche = { id: Date.now(), market: selectedMarket, price: price, month: point.month || '26.01', isFuture: false, percentage: Math.min(10, remaining) };
      setTranches([...tranches, newTranche]);
    }
  };

  // [ADDED] AI Generation Logic
  const generateAIPlan = () => {
    setIsChatOpen(true);
    // [BACKEND_INTEGRATION] : LLM API 호출 (POST /api/ai/strategy) 
    // payload: { companyId: selectedCompanyId, market: selectedMarket, ... }
    setChatMessages(prev => [...prev, { role: 'user', text: "시장 동향을 분석하여 최적의 분할 매수 전략을 생성해줘." }]);

    // Simulate AI processing time
    setTimeout(() => {
      const market = MARKET_DATA[selectedMarket];
      const isHighVolatility = market.volatility === 'High';

      const newTranches: Tranche[] = [
        { id: Date.now(), market: selectedMarket, price: Math.round(market.price * 0.98), month: '26.02', isFuture: true, percentage: isHighVolatility ? 20 : 40 },
        { id: Date.now() + 1, market: selectedMarket, price: Math.round(market.price * 0.95), month: '26.05', isFuture: true, percentage: isHighVolatility ? 20 : 30 },
        { id: Date.now() + 2, market: selectedMarket, price: Math.round(market.price * 1.02), month: '26.09', isFuture: true, percentage: isHighVolatility ? 20 : 10 },
      ];

      setTranches(newTranches);

      const strategyText = isHighVolatility
        ? `⚠️ [고변동성 감지] ${market.name} 시장의 변동성이 높습니다. 리스크 분산을 위해 3~4회에 걸친 분할 매수(Tranche) 전략을 제안합니다.`
        : `✅ [안정적 추세] ${market.name} 시장 가격이 안정적입니다. 저점 매수를 위해 상반기에 물량을 집중하는 공격적 전략을 제안합니다.`;

      setChatMessages(prev => [...prev, {
        role: 'assistant',
        text: `${strategyText}\n\n📊 생성된 플랜:\n- 26.02 (40%): 단기 저점 예상\n- 26.05 (30%): 추가 하락 대응\n- 26.09 (30%): 잔여 물량 확보`
      }]);

    }, 1500);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    const userText = inputMessage;
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInputMessage('');
    setTimeout(() => {
      if (userText.includes('전략') || userText.includes('추천') || userText.includes('생성')) {
        // Trigger the AI Plan Logic if user asks via chat too
        generateAIPlan();
        return;
      }

      const aiResponse = `${selectedMarket} 시장 데이터를 분석 중입니다. "매수 전략 생성해줘"라고 물어보세요.`;
      setChatMessages(prev => [...prev, { role: 'assistant', text: aiResponse }]);
    }, 800);
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'dashboard', label: '대시보드' },
    { id: 'compare', label: '비교 분석' },
    { id: 'simulator', label: '시뮬레이터' },
    { id: 'target', label: '목표 관리' },
    { id: 'investment', label: '투자 전략' },
  ];

  return (
    <div className="min-h-screen bg-[#F8FCFA] text-slate-900 flex flex-col" style={{ fontFamily: '"Pretendard", "Malgun Gothic", sans-serif' }}>
      {/* Defined Gradients for Charts */}
      <svg style={{ height: 0 }}>
        <defs>
          <linearGradient id="colorEmerald" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b77f" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b77f" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorLiability" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.1} />
            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="targetGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b77f" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b77f" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradientSavings" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b77f" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#10b77f" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>

      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tabs={tabs}
        selectedCompany={MOCK_COMPANIES.find(c => c.id === selectedCompId) || MOCK_COMPANIES[0]}
        setSelectedCompanyId={setSelectedCompId}
        companies={MOCK_COMPANIES}
      />

      <main className="flex-1 p-6 lg:p-10 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in duration-500">

        {activeTab === 'dashboard' && (
          <DashboardTab
            selectedComp={selectedComp}
            costEU_KRW={costEU_KRW}
            ytdAnalysis={ytdAnalysis}
            intensityType={intensityType}
            sbtiAnalysis={sbtiAnalysis}
          />
        )}

        {activeTab === 'compare' && (
          <CompareTab
            intensityType={intensityType}
            setIntensityType={setIntensityType}
            chartData={chartData}
            selectedCompId={selectedCompId}
            setSelectedCompId={setSelectedCompId}
            activeScopes={activeScopes}
            setActiveScopes={setActiveScopes}
            topThreshold={topThreshold}
            medianThreshold={medianThreshold}
            isInsightOpen={isInsightOpen}
            setIsInsightOpen={setIsInsightOpen}
          />
        )}

        {activeTab === 'simulator' && (
          <SimulatorTab
            selectedMarket={selectedMarket}
            setSelectedMarket={setSelectedMarket}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            trendData={trendData}
            handleChartClick={handleChartClick}
            activeTranches={activeTranches}
            totalExposure={totalExposure}
            simBudget={simBudget}
            setSimBudget={setSimBudget}
            simRisk={simRisk}
            setSimRisk={setSimRisk}
            budgetInWon={budgetInWon}
            estimatedSavings={estimatedSavings}
            generateAIPlan={generateAIPlan}
          />
        )}

        {activeTab === 'target' && (
          <TargetTab sbtiAnalysis={sbtiAnalysis} />
        )}

        {activeTab === 'investment' && (
          <InvestmentTab
            investTotalAmount={investTotalAmount}
            investCarbonPrice={investCarbonPrice}
            setInvestCarbonPrice={setInvestCarbonPrice}
            investEnergySavings={investEnergySavings}
            setInvestEnergySavings={setInvestEnergySavings}
            investDiscountRate={investDiscountRate}
            setInvestDiscountRate={setInvestDiscountRate}
            investTimeline={investTimeline}
            setInvestTimeline={setInvestTimeline}
            investmentAnalysis={investmentAnalysis}
          />
        )}

      </main>

      <ChatBot
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
        chatMessages={chatMessages}
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        handleSendMessage={handleSendMessage}
        chatEndRef={chatEndRef}
      />
    </div>
  );
};

export default App;

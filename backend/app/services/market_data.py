import pandas as pd
import FinanceDataReader as fdr
import yfinance as yf
from yahoo_fin import stock_info as si
from datetime import datetime, timedelta
import asyncio
import numpy as np
import matplotlib.pyplot as plt  # 차트 그리기용
import os
from ..config import settings

class MarketDataService:
    # 클래스 레벨 변수 (모든 요청이 이 메모리를 공유함)
    _cache = [] 
    _last_updated = None
    _is_updating = False

    def __init__(self):
        self.krx_api_key = settings.KRX_API_KEY

    async def preload_data(self):
        """데이터 로딩 후 리포트 파일 생성까지 수행"""
        print("[System] Preloading market data...")
        data = await asyncio.to_thread(self._fetch_dual_market_data, days=1095)  # 3년치
        
        # 캐시 저장
        MarketDataService._cache = data
        MarketDataService._last_updated = datetime.now()
        
        # ★ 핵심: 눈으로 볼 수 있게 파일로 저장하기
        self._generate_debug_files(data)
        
        print(f"[System] Market data cached! ({len(data)} rows)")
        print(f"[Report] Generated 'market_report.md' & 'market_chart.png'")

    def _fetch_dual_market_data(self, days=365):
        """
        [3중 안전장치] yfinance -> yahoo_fin -> FDR 순서로 데이터 확보
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        # ==========================================
        # 1. EU-ETS (유럽 탄소배출권)
        # ==========================================
        eu_series = pd.Series(dtype=float)
        
        # [Try 0] Alpha Vantage (High priority if key exists)
        if settings.ALPHA_VANTAGE_API_KEY:
            try:
                import httpx
                # Alpha Vantage는 심볼이 다양하므로 FCO2.FRK (Frankfurt) 등 시도
                av_url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=FCO2.FRK&apikey={settings.ALPHA_VANTAGE_API_KEY}"
                with httpx.Client() as client:
                    resp = client.get(av_url)
                    if resp.status_code == 200:
                        av_data = resp.json()
                        if "Time Series (Daily)" in av_data:
                            ts = av_data["Time Series (Daily)"]
                            # 데이터 변환
                            temp_data = {datetime.strptime(k, "%Y-%m-%d"): float(v["4. close"]) for k, v in ts.items() if start_date <= datetime.strptime(k, "%Y-%m-%d") <= end_date}
                            if temp_data:
                                eu_series = pd.Series(temp_data)
                                print("[System] Alpha Vantage EU success!")
            except Exception as e:
                print(f"[Error] Alpha Vantage EU failed: {e}")

        # [Try 1] yfinance
        if eu_series.empty:
            try:
                # 주 계약 티커 시도
                eu_df = yf.download("FCO2.DE", start=start_date, end=end_date, progress=False)
                if not eu_df.empty:
                    if isinstance(eu_df.columns, pd.MultiIndex):
                        eu_series = eu_df['Close'].iloc[:, 0]
                    else:
                        eu_series = eu_df['Close']
            except Exception as e:
                print(f"[Error] yfinance EU failed: {e}")

        # [Try 2] yahoo_fin (Last Backup - 웹 스크래핑 방식)
        if eu_series.empty:
            try:
                print("[System] Switching to yahoo_fin backup for EU-ETS...")
                eu_df_backup = si.get_data("FCO2.DE", start_date=start_date, end_date=end_date)
                if not eu_df_backup.empty:
                    eu_series = eu_df_backup['close']
                    print("[System] yahoo_fin EU success!")
            except Exception as e:
                print(f"[Error] yahoo_fin EU failed: {e}")

        # ==========================================
        # 2. K-ETS (한국 탄소배출권)
        # ==========================================
        kr_series = pd.Series(dtype=float)
        
        # [Try 1] FinanceDataReader (KAU 종목 검색)
        try:
            df_krx = fdr.StockListing('KRX')
            kau_list = df_krx[df_krx['Name'].str.contains('KAU', case=False, na=False)]
            
            if not kau_list.empty:
                target_code = kau_list.sort_values(by='Symbol').iloc[-1]['Symbol']
                kr_df = fdr.DataReader(target_code, start=start_date, end=end_date)
                if not kr_df.empty:
                    kr_series = kr_df['Close']
        except Exception as e:
            print(f"[Error] FDR K-ETS failed: {e}")
            
        # [Try 2] KODEX ETF (백업용) - yfinance
        if kr_series.empty:
            try:
                # 400590.KS: KODEX 탄소배출권선물 (한국 티커는 뒤에 .KS 붙임)
                kr_df = yf.download("400590.KS", start=start_date, end=end_date, progress=False)
                if not kr_df.empty:
                    if isinstance(kr_df.columns, pd.MultiIndex):
                        kr_series = kr_df['Close'].iloc[:, 0]
                    else:
                        kr_series = kr_df['Close']
                    kr_series = kr_series * 0.9 # ETF 괴리율 보정
                    print("[System] yfinance K-ETS (ETF) success!")
            except Exception as e:
                print(f"[Error] yfinance K-ETS failed: {e}")

        # [Try 3] yahoo_fin (Last Backup for Korea)
        if kr_series.empty:
            try:
                print("[System] Switching to yahoo_fin backup for K-ETS...")
                kr_df_backup = si.get_data("400590.KS", start_date=start_date, end_date=end_date)
                if not kr_df_backup.empty:
                    kr_series = kr_df_backup['close'] * 0.9
                    print("[System] yahoo_fin K-ETS success!")
            except Exception as e:
                print(f"[Error] yahoo_fin K-ETS failed: {e}")

        # ==========================================
        # 3. 데이터 병합 및 정제
        # ==========================================
        df_merge = pd.DataFrame({"EU_ETS": eu_series, "K_ETS": kr_series})
        df_merge.sort_index(inplace=True)
        
        # 4. 현실적인 폴백 (모든 데이터 소스가 실패할 경우)
        if df_merge["EU_ETS"].isnull().all() or (df_merge["EU_ETS"] == 0).all():
            print("Warning: EU_ETS data is all NaN or 0. Applying urgent mock fallback.")
            dates = df_merge.index if not df_merge.empty else pd.date_range(start_date, end_date)
            df_merge = pd.DataFrame(index=dates) if df_merge.empty else df_merge
            np.random.seed(42) # 데이터 일관성을 위해 시드 고정
            df_merge["EU_ETS"] = 72.0 + np.cumsum(np.random.normal(0, 0.4, len(df_merge))) + np.random.normal(0, 0.2, len(df_merge))

        if df_merge["K_ETS"].isnull().all() or (df_merge["K_ETS"] == 0).all():
            print("Warning: K_ETS data is all NaN or 0. Applying urgent mock fallback.")
            dates = df_merge.index if not df_merge.empty else pd.date_range(start_date, end_date)
            df_merge = pd.DataFrame(index=dates) if df_merge.empty else df_merge
            np.random.seed(42) # 데이터 일관성을 위해 시드 고정
            df_merge["K_ETS"] = 15500 + np.cumsum(np.random.normal(0, 50, len(df_merge))) + np.random.normal(0, 100, len(df_merge))

        df_merge = df_merge.ffill().bfill()

        # JSON 변환
        result = []
        for date, row in df_merge.iterrows():
            eu_val = row['EU_ETS'] if pd.notnull(row['EU_ETS']) else 0
            kr_val = row['K_ETS'] if pd.notnull(row['K_ETS']) else 0
            result.append({
                "date": date.strftime("%Y-%m-%d"),
                "euPrice": round(float(eu_val), 2),
                "krPrice": int(kr_val)
            })
        return result

    def get_current_prices(self):
        """
        [Real-time] 현재 KAU/EUA 가격 및 전일 대비 등락률 조회
        """
        try:
            # 캐시가 없으면 로딩 시도
            if not MarketDataService._cache:
                # 동기 환경에서 호출 시, async 함수를 바로 못 부르므로 
                # (여기서는 간단히 KRX만 실시간 조회하거나, 캐시가 비어있으면 기본값 리턴)
                pass 
            
            # 1. K-ETS (한국)
            kr_data = self.get_carbon_price_krx()
            
            # 2. EU-ETS (유럽)
            eu_price = 74.50
            
            # ★ 핵심: 차트 데이터와 실시간 카드 가격 일치시키기
            if MarketDataService._cache:
                latest = MarketDataService._cache[-1]
                kr_data['price'] = latest['krPrice']
                eu_price = latest['euPrice']

            # 변동률 계산 (최근 2일 데이터 비교)
            kr_change = 0.0
            eu_change = 0.0
            if len(MarketDataService._cache) >= 2:
                yesterday = MarketDataService._cache[-2]
                today = MarketDataService._cache[-1]
                
                if yesterday['krPrice'] > 0:
                    kr_change = ((today['krPrice'] - yesterday['krPrice']) / yesterday['krPrice']) * 100
                if yesterday['euPrice'] > 0:
                    eu_change = ((today['euPrice'] - yesterday['euPrice']) / yesterday['euPrice']) * 100

            return {
                "K-ETS": {
                    "price": kr_data['price'],
                    "change": round(kr_change, 2),
                    "ticker": "KAU"
                },
                "EU-ETS": {
                    "price": eu_price,
                    "change": round(eu_change, 2),
                    "ticker": "EUA"
                }
            }
        except Exception as e:
            print(f"[Error] get_current_prices: {e}")
            return {
                "K-ETS": {"price": 15450, "change": 0.0, "ticker": "KAU"},
                "EU-ETS": {"price": 74.50, "change": 0.0, "ticker": "EUA"}
            }


    async def get_dual_market_history(self, period: str = "1y"):
        """
        [핵심] 캐시된 데이터를 먼저 반환하고, 오래되었으면 갱신
        """
        if not MarketDataService._cache:
            await self.preload_data()
        
        time_diff = datetime.now() - (MarketDataService._last_updated or datetime.min)
        if time_diff > timedelta(minutes=30) and not MarketDataService._is_updating:
            print("[System] Cache expired. Refreshing market data in background...")
            MarketDataService._is_updating = True
            asyncio.create_task(self._refresh_cache())

        cached_data = MarketDataService._cache
        days_map = {"1m": 30, "3m": 90, "1y": 365, "all": 1095}
        req_days = days_map.get(period, 365)
        
        if len(cached_data) > req_days:
            return cached_data[-req_days:] 
        return cached_data

    async def _refresh_cache(self):
        try:
            new_data = await asyncio.to_thread(self._fetch_dual_market_data, days=1095)
            if new_data:
                MarketDataService._cache = new_data
                MarketDataService._last_updated = datetime.now()
                print("[System] Cache refreshed successfully.")
        finally:
            MarketDataService._is_updating = False

    def _generate_debug_files(self, data):
        """수집된 데이터를 MD파일과 이미지로 저장하는 함수"""
        if not data:
            return

        # 1. Pandas DataFrame으로 변환
        df = pd.DataFrame(data)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)

        # === A. 마크다운 리포트 생성 (market_report.md) ===
        try:
            with open("market_report.md", "w", encoding="utf-8") as f:
                f.write(f"# 📊 ESG Market Data Report\n")
                f.write(f"**Updated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                f.write(f"**Total Rows:** {len(df)}\n\n")
                f.write("## Recent 10 Days Data\n")
                # 최근 10개 데이터만 표로 예쁘게 출력
                f.write(df.tail(10).to_markdown())
                f.write("\n\n## Data Statistics\n")
                f.write(df.describe().to_markdown())
        except Exception as e:
            print(f"[Warning] Report Generation Failed: {e}")

        # === B. 차트 이미지 생성 (market_chart.png) ===
        try:
            plt.figure(figsize=(10, 5))

            # 이중 축 그래프 그리기
            ax1 = plt.gca()
            ax2 = ax1.twinx()

            # EU-ETS (유럽) - 파란색
            ax1.plot(df.index, df['euPrice'], 'b-', label='EU-ETS (EUR)')
            ax1.set_ylabel('EU-ETS Price (EUR)', color='b')
            ax1.tick_params(axis='y', labelcolor='b')

            # K-ETS (한국) - 빨간색
            ax2.plot(df.index, df['krPrice'], 'r-', label='K-ETS (KRW)')
            ax2.set_ylabel('K-ETS Price (KRW)', color='r')
            ax2.tick_params(axis='y', labelcolor='r')

            plt.title('Global Carbon Market Trend (Backend Generated)')
            plt.grid(True, alpha=0.3)

            # 파일로 저장
            plt.savefig("market_chart.png")
            plt.close()  # 메모리 해제
        except Exception as e:
            print(f"[Warning] Chart Generation Failed: {e}")

    def get_carbon_price_krx(self):
        try:
            if MarketDataService._cache:
                latest = MarketDataService._cache[-1]
                return {"price": latest["krPrice"], "unit": "KRW", "source": "Cached(KRX)"}
            
            df = fdr.DataReader('400590', datetime.now() - timedelta(days=7))
            return {"price": float(df['Close'].iloc[-1]), "unit": "KRW", "source": "KRX"}
        except:
            return {"price": 10500.0, "unit": "KRW", "source": "Fallback"}

market_service = MarketDataService()

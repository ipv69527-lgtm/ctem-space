import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Space, Tag, Typography } from 'antd';
import {
  AlertOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  BankOutlined,
  CloudSyncOutlined,
  DesktopOutlined,
  FireOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  FundViewOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as echarts from 'echarts/core';
import { BarChart, EffectScatterChart, LineChart, MapChart, PieChart } from 'echarts/charts';
import { GeoComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import apiClient from '@/api/client';
import type { Asset, AssetQualityReport, DashboardData, SyncTask, SyncTaskSummary, Unit, Vulnerability } from '@/types';

echarts.use([BarChart, EffectScatterChart, LineChart, MapChart, PieChart, GeoComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const ANHUI_URL = '/maps/anhui.json';
const ANHUI_CITY_URL_PREFIX = '/maps/anhui-cities';
const geoCache: Record<string, unknown> = {};
const riskColors: Record<string, string> = { 严重: '#ff4d4f', 高危: '#fa8c16', 中危: '#2f80ed', 低危: '#34c759' };
const fixedStatuses = new Set(['已修复', '误报', '接受风险']);
const riskWeight: Record<string, number> = { 严重: 12, 高危: 8, 中危: 4, 低危: 1 };

type MapLevel = 'city' | 'county';

interface MapRegion {
  level: MapLevel;
  mapName: string;
  label: string;
  url: string;
  parent?: MapRegion;
}

const ANHUI_REGION: MapRegion = {
  level: 'city',
  mapName: 'anhui_leadership_city',
  label: '安徽省市级态势',
  url: ANHUI_URL,
};

interface AssetLocation {
  id: string;
  name: string;
  ip: string;
  risk: string;
  unit_id: string | null;
  unit_name: string;
  ports: string;
  services: string;
  vuln_count: number;
  longitude: number;
  latitude: number;
}

function splitTokens(value?: string | null) {
  return String(value || '')
    .split(/[,，;；\s\n\r]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function topTokens(values: string[], limit = 6) {
  const counter = new Map<string, number>();
  values.forEach(value => counter.set(value, (counter.get(value) || 0) + 1));
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '-';
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function lastDays(days = 14) {
  const now = new Date();
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(now);
    day.setDate(now.getDate() - (days - index - 1));
    return day;
  });
}

function sameDay(left: Date, value?: string | null) {
  if (!value) return false;
  const right = new Date(value);
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

async function loadGeoJSON(url: string, key: string) {
  if (geoCache[key]) return geoCache[key];
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to load map');
  const data = await resp.json();
  geoCache[key] = data;
  return data;
}

function pointInRing(point: [number, number], ring: number[][]) {
  const [lng, lat] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[j];
    const intersects = ((lat1 > lat) !== (lat2 > lat))
      && (lng < ((lng2 - lng1) * (lat - lat1)) / (lat2 - lat1) + lng1);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: [number, number], coordinates: number[][][]) {
  if (!coordinates.length || !pointInRing(point, coordinates[0])) return false;
  return !coordinates.slice(1).some((ring) => pointInRing(point, ring));
}

function featureContainsPoint(feature: any, point: [number, number]) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon: number[][][]) => pointInPolygon(point, polygon));
  return false;
}

function findFeatureByCoordinate(geoJSON: any, longitude: number, latitude: number) {
  if (!geoJSON?.features || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const point: [number, number] = [longitude, latitude];
  return geoJSON.features.find((feature: any) => featureContainsPoint(feature, point)) || null;
}

function areaColor(score: number, index: number) {
  if (score >= 60) return '#7f1d1d';
  if (score >= 30) return '#b45309';
  if (score >= 12) return '#1d4ed8';
  if (score > 0) return '#0f766e';
  return index % 2 === 0 ? '#102f55' : '#0b2748';
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(8, 25, 48, .96), rgba(5, 16, 32, .96))',
  border: '1px solid rgba(89, 196, 255, .18)',
  boxShadow: '0 16px 40px rgba(0, 0, 0, .28), inset 0 1px 0 rgba(255,255,255,.04)',
  borderRadius: 8,
  padding: 14,
  minWidth: 0,
};

const panelTitleStyle: React.CSSProperties = {
  color: '#dcecff',
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

function Metric({ label, value, suffix, color, icon }: { label: string; value: number | string; suffix?: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={{ ...panelStyle, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center', color, background: `${color}18`, fontSize: 19 }}>
        {icon}
      </div>
      <div>
        <div style={{ color: '#89a8c7', fontSize: 12 }}>{label}</div>
        <div style={{ color: '#fff', fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>
          {value}<span style={{ fontSize: 13, color: '#8fb4d8', marginLeft: 4 }}>{suffix}</span>
        </div>
      </div>
    </div>
  );
}

function RankingList({ rows, unit = '' }: { rows: { name: string; count: number; color?: string }[]; unit?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length ? rows.map((row, index) => (
        <div key={`${row.name}-${index}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cfe6ff', fontSize: 12, marginBottom: 4 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{index + 1}. {row.name}</span>
            <strong style={{ color: row.color || '#fff' }}>{row.count}{unit}</strong>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, row.count * 8)}%`, height: '100%', background: row.color || '#2f80ed' }} />
          </div>
        </div>
      )) : <Typography.Text style={{ color: '#7896b3' }}>暂无数据</Typography.Text>}
    </div>
  );
}

export default function LeadershipScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cockpitRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);
  const unitRef = useRef<HTMLDivElement>(null);
  const funnelRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [currentRegion, setCurrentRegion] = useState<MapRegion>(ANHUI_REGION);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { data: stats } = useQuery<DashboardData>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => { const { data } = await apiClient.get('/dashboard/stats'); return data; },
  });
  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => { const { data } = await apiClient.get('/units/'); return data; },
  });
  const { data: assets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => { const { data } = await apiClient.get('/assets/'); return data; },
  });
  const { data: vulns } = useQuery<Vulnerability[]>({
    queryKey: ['vulns'],
    queryFn: async () => { const { data } = await apiClient.get('/vulnerabilities/'); return data; },
  });
  const { data: qualityReport } = useQuery<AssetQualityReport>({
    queryKey: ['asset-quality-report'],
    queryFn: async () => { const { data } = await apiClient.get('/assets/quality/report'); return data; },
  });
  const { data: syncSummary } = useQuery<SyncTaskSummary>({
    queryKey: ['sync-task-summary'],
    queryFn: async () => { const { data } = await apiClient.get('/sync/task-summary'); return data; },
    refetchInterval: 5000,
  });
  const { data: syncTasks } = useQuery<SyncTask[]>({
    queryKey: ['sync-tasks-leadership'],
    queryFn: async () => { const { data } = await apiClient.get('/sync/tasks'); return data; },
    refetchInterval: 5000,
  });
  const { data: assetLocations } = useQuery<AssetLocation[]>({
    queryKey: ['screen-asset-locations'],
    queryFn: async () => { const { data } = await apiClient.get('/dashboard/asset-locations'); return data; },
  });

  const totalAssets = assets?.length ?? stats?.total_assets ?? 0;
  const totalUnits = units?.length ?? stats?.total_units ?? 0;
  const ports = useMemo(() => (assets || []).flatMap(asset => splitTokens(asset.ports)), [assets]);
  const services = useMemo(() => (assets || []).flatMap(asset => splitTokens(asset.services)), [assets]);
  const exposedPorts = new Set(ports).size;
  const criticalHigh = (vulns || []).filter(vuln => ['严重', '高危'].includes(vuln.severity)).length;
  const pocVerified = (vulns || []).filter(vuln => vuln.poc_status === 'verified').length;
  const fixedVulns = (vulns || []).filter(vuln => fixedStatuses.has(vuln.status)).length;
  const remediationRate = percent(fixedVulns, vulns?.length || 0);
  const highRiskAssets = (assets || []).filter(asset => ['严重', '高危'].includes(asset.risk)).length;
  const assignedRate = qualityReport?.assigned_rate || percent((assets || []).filter(asset => asset.unit_id).length, totalAssets);
  const missingCoordinate = qualityReport?.issues?.find(issue => issue.key === 'missing_coordinates')?.count || 0;
  const unassigned = qualityReport?.unassigned_assets || 0;

  const topPorts = useMemo(() => topTokens(ports, 5), [ports]);
  const topServices = useMemo(() => topTokens(services, 5), [services]);
  const topRiskUnits = useMemo(() => (stats?.top_risk_units || []).slice(0, 6).map(unit => ({
    name: unit.name,
    count: unit.critical_vuln + unit.high_vuln,
    color: unit.critical_vuln ? '#ff4d4f' : '#fa8c16',
  })), [stats]);
  const urgentVulns = useMemo(() => (vulns || [])
    .filter(vuln => ['严重', '高危'].includes(vuln.severity) || vuln.poc_status === 'verified')
    .sort((a, b) => (b.poc_status === 'verified' ? 10 : 0) + (b.severity === '严重' ? 8 : 0) - ((a.poc_status === 'verified' ? 10 : 0) + (a.severity === '严重' ? 8 : 0)))
    .slice(0, 6), [vulns]);

  const trend = useMemo(() => {
    const days = lastDays(14);
    return {
      labels: days.map(day => `${day.getMonth() + 1}/${day.getDate()}`),
      assets: days.map(day => (assets || []).filter(asset => sameDay(day, asset.last_seen || asset.created_at)).length),
      vulns: days.map(day => (vulns || []).filter(vuln => sameDay(day, vuln.last_found || vuln.created_at)).length),
    };
  }, [assets, vulns]);

  const refreshAll = () => {
    ['dashboard-stats', 'assets', 'vulns', 'asset-quality-report', 'sync-task-summary', 'sync-tasks-leadership', 'screen-asset-locations', 'units']
      .forEach(key => queryClient.invalidateQueries({ queryKey: [key] }));
    setNow(new Date());
  };

  const resetMap = () => setCurrentRegion(ANHUI_REGION);
  const goBackMap = () => currentRegion.parent && setCurrentRegion(currentRegion.parent);
  const drillToCountyLevel = (name: string, adcode: number) => {
    setCurrentRegion({
      level: 'county',
      mapName: `anhui_leadership_county_${adcode}`,
      label: `${name}区县级态势`,
      url: `${ANHUI_CITY_URL_PREFIX}/${adcode}.json`,
      parent: ANHUI_REGION,
    });
  };
  const resizeCharts = () => window.setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
  const toggleFullscreen = async () => {
    const panel = cockpitRef.current;
    if (!panel) return;
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      resizeCharts();
      return;
    }
    setIsFullscreen(true);
    try {
      await panel.requestFullscreen();
    } catch {
      // Browser fullscreen can be blocked; fixed-position expansion remains available.
    }
    resizeCharts();
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement === cockpitRef.current) setIsFullscreen(true);
      if (!document.fullscreenElement) setIsFullscreen(false);
      resizeCharts();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    let chart: echarts.ECharts | null = null;
    let canceled = false;
    const render = async () => {
      if (!mapRef.current) return;
      const geoJSON = await loadGeoJSON(currentRegion.url, currentRegion.mapName);
      if (canceled || !mapRef.current) return;
      echarts.registerMap(currentRegion.mapName, geoJSON as any);
      chart = echarts.init(mapRef.current);
      const points = (assetLocations || [])
        .map(asset => ({
          name: asset.name || asset.ip,
          value: [Number(asset.longitude), Number(asset.latitude), Math.max(riskWeight[asset.risk] || 4, asset.vuln_count || 1)],
          asset,
          itemStyle: { color: riskColors[asset.risk] || '#2f80ed' },
        }))
        .filter(item => Number.isFinite(item.value[0]) && Number.isFinite(item.value[1]));
      const areaData = (geoJSON as any).features.map((feature: any, index: number) => {
        const assetsInArea = points.filter(point => featureContainsPoint(feature, [Number(point.value[0]), Number(point.value[1])]));
        const score = assetsInArea.reduce((sum, point) => sum + (riskWeight[point.asset.risk] || 1) + (point.asset.vuln_count || 0), 0);
        return {
          name: feature.properties.name,
          value: score,
          asset_count: assetsInArea.length,
          high_assets: assetsInArea.filter(point => ['严重', '高危'].includes(point.asset.risk)).length,
          vuln_count: assetsInArea.reduce((sum, point) => sum + (point.asset.vuln_count || 0), 0),
          adcode: feature.properties.adcode,
          properties: feature.properties,
          itemStyle: { areaColor: areaColor(score, index) },
        };
      });
      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: 'rgba(6,18,36,.95)',
          borderColor: 'rgba(89,196,255,.28)',
          textStyle: { color: '#dcecff' },
          formatter: (params: any) => {
            if (params.seriesType === 'map') {
              const item = params.data || {};
              return [
                `<strong>${params.name}</strong>`,
                `资产数：${item.asset_count || 0}`,
                `高风险资产：${item.high_assets || 0}`,
                `关联漏洞：${item.vuln_count || 0}`,
                currentRegion.level === 'city' ? '点击下钻到区县级' : '区县级态势',
              ].join('<br/>');
            }
            const asset = params.data?.asset;
            if (!asset) return params.name;
            return `${asset.name || asset.ip}<br/>IP：${asset.ip}<br/>风险：${asset.risk}<br/>漏洞：${asset.vuln_count || 0}`;
          },
        },
        geo: {
          map: currentRegion.mapName,
          roam: false,
          zoom: currentRegion.level === 'city' ? 1.08 : 1,
          layoutCenter: ['50%', '52%'],
          layoutSize: currentRegion.level === 'city' ? '96%' : '92%',
          itemStyle: {
            areaColor: '#102f55',
            borderColor: '#4cb8ff',
            borderWidth: 1,
            shadowBlur: 20,
            shadowColor: 'rgba(76,184,255,.2)',
          },
          label: { show: true, color: '#9fc7e8', fontSize: 10 },
          emphasis: { itemStyle: { areaColor: '#174c7b' }, label: { color: '#fff' } },
        },
        visualMap: { show: false, min: 0, max: 20, inRange: { color: ['#1d6fb8', '#faad14', '#ff4d4f'] } },
        series: [
          {
            type: 'map',
            map: currentRegion.mapName,
            geoIndex: 0,
            data: areaData,
            itemStyle: { borderColor: '#4cb8ff', borderWidth: 0.75 },
            emphasis: { itemStyle: { areaColor: '#255f95', borderColor: '#9bd7ff', borderWidth: 1.15 } },
          },
          {
            name: '资产点位',
            type: 'effectScatter',
            coordinateSystem: 'geo',
            data: points,
            symbolSize: (value: number[]) => Math.max(10, Math.min(26, Number(value[2]) * 3 + 9)),
            rippleEffect: { scale: 2.8, brushType: 'stroke' },
            label: { show: false },
          },
        ],
      });
      chart.off('click');
      chart.on('click', (params: any) => {
        const data = params.data || {};
        let name = params.name || data.name || data.properties?.name;
        let adcode = Number(data.adcode || data.properties?.adcode);
        const asset = data.asset;
        if (currentRegion.level === 'city' && !Number.isFinite(adcode) && asset) {
          const feature = findFeatureByCoordinate(geoJSON, Number(asset.longitude), Number(asset.latitude));
          name = feature?.properties?.name || name;
          adcode = Number(feature?.properties?.adcode);
        }
        if (currentRegion.level === 'city' && Number.isFinite(adcode)) drillToCountyLevel(name, adcode);
      });
    };
    render();
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      canceled = true;
      window.removeEventListener('resize', onResize);
      chart?.dispose();
    };
  }, [assetLocations, currentRegion]);

  useEffect(() => {
    if (!trendRef.current) return;
    const chart = echarts.init(trendRef.current);
    chart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { left: 34, right: 18, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: trend.labels, axisLabel: { color: '#8fb4d8' }, axisLine: { lineStyle: { color: '#1e4d78' } } },
      yAxis: { type: 'value', axisLabel: { color: '#8fb4d8' }, splitLine: { lineStyle: { color: 'rgba(143,180,216,.12)' } } },
      series: [
        { name: '新增资产', type: 'line', smooth: true, data: trend.assets, areaStyle: { opacity: 0.16 }, lineStyle: { color: '#2f80ed' }, itemStyle: { color: '#2f80ed' } },
        { name: '新增漏洞', type: 'line', smooth: true, data: trend.vulns, areaStyle: { opacity: 0.12 }, lineStyle: { color: '#ff4d4f' }, itemStyle: { color: '#ff4d4f' } },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [trend]);

  useEffect(() => {
    if (!unitRef.current) return;
    const assigned = Math.round(assignedRate * totalAssets / 100);
    const chart = echarts.init(unitRef.current);
    chart.setOption({
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: '#9fc7e8' } },
      series: [{
        type: 'pie',
        radius: ['54%', '76%'],
        center: ['50%', '42%'],
        label: { color: '#dcecff' },
        data: [
          { name: '已归属', value: assigned, itemStyle: { color: '#34c759' } },
          { name: '未归属', value: Math.max(totalAssets - assigned, 0), itemStyle: { color: '#faad14' } },
        ],
      }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [assignedRate, totalAssets]);

  useEffect(() => {
    if (!funnelRef.current) return;
    const statuses = ['待确认', '待整改', '整改中', '待复测', '已修复'];
    const chart = echarts.init(funnelRef.current);
    chart.setOption({
      grid: { left: 70, right: 18, top: 12, bottom: 20 },
      xAxis: { type: 'value', axisLabel: { color: '#8fb4d8' }, splitLine: { lineStyle: { color: 'rgba(143,180,216,.12)' } } },
      yAxis: { type: 'category', data: statuses, axisLabel: { color: '#dcecff' }, axisLine: { show: false } },
      series: [{
        type: 'bar',
        data: statuses.map(status => (vulns || []).filter(vuln => vuln.status === status).length),
        barWidth: 12,
        itemStyle: { color: '#2f80ed', borderRadius: [0, 8, 8, 0] },
      }],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.dispose(); };
  }, [vulns]);

  return (
    <div ref={cockpitRef} style={{
      minHeight: isFullscreen ? '100vh' : 'calc(100vh - 100px)',
      margin: isFullscreen ? 0 : -24,
      padding: 20,
      color: '#dcecff',
      background: 'radial-gradient(circle at 50% 0%, rgba(25,118,210,.22), transparent 34%), linear-gradient(135deg, #061120 0%, #071a31 44%, #050b16 100%)',
      position: isFullscreen ? 'fixed' : 'relative',
      inset: isFullscreen ? 0 : undefined,
      zIndex: isFullscreen ? 1000 : undefined,
      width: isFullscreen ? '100vw' : undefined,
      height: isFullscreen ? '100vh' : undefined,
      overflow: isFullscreen ? 'auto' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space size={12}>
          <FundViewOutlined style={{ color: '#59c4ff', fontSize: 28 }} />
          <div>
            <Typography.Title level={2} style={{ color: '#fff', margin: 0, letterSpacing: 0 }}>CTEM 驾驶舱</Typography.Title>
            <Typography.Text style={{ color: '#8fb4d8' }}>暴露面风险、修复进展、单位责任和数据质量一屏掌握</Typography.Text>
          </div>
        </Space>
        <Space>
          <Typography.Text style={{ color: '#9fc7e8' }}>更新时间：{now.toLocaleString('zh-CN')}</Typography.Text>
          <Button ghost icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
          <Button ghost icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleFullscreen}>
            {isFullscreen ? '退出全屏' : '全屏'}
          </Button>
          <Button ghost onClick={() => navigate('/screen')}>区域作战指挥图</Button>
        </Space>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(120px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Metric label="纳管单位" value={totalUnits} color="#59c4ff" icon={<BankOutlined />} />
        <Metric label="资产总数" value={totalAssets} color="#2f80ed" icon={<DesktopOutlined />} />
        <Metric label="暴露端口" value={exposedPorts} color="#13c2c2" icon={<ApartmentOutlined />} />
        <Metric label="严重/高危漏洞" value={criticalHigh} color="#ff4d4f" icon={<AlertOutlined />} />
        <Metric label="POC验证命中" value={pocVerified} color="#fa8c16" icon={<FireOutlined />} />
        <Metric label="修复闭环率" value={remediationRate} suffix="%" color="#34c759" icon={<SafetyOutlined />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(360px, 1fr) 280px', gridTemplateRows: 'minmax(510px, 1fr) 230px', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={panelStyle}>
            <div style={panelTitleStyle}>单位风险排行 <Tag color="red">Top</Tag></div>
            <RankingList rows={topRiskUnits} />
          </div>
          <div style={panelStyle}>
            <div style={panelTitleStyle}>资产归属质量 <Tag color={unassigned ? 'orange' : 'green'}>{assignedRate}%</Tag></div>
            <div ref={unitRef} style={{ height: 190 }} />
            <Space wrap>
              <Tag color="green">已归属 {Math.round(assignedRate * totalAssets / 100)}</Tag>
              <Tag color="orange">未归属 {unassigned}</Tag>
              <Tag color="blue">缺经纬度 {missingCoordinate}</Tag>
            </Space>
          </div>
        </div>

        <div style={{ ...panelStyle, padding: 0, position: 'relative', overflow: 'hidden' }}>
          <div style={{ ...panelTitleStyle, padding: '14px 16px 0', marginBottom: 0 }}>
            <span>安徽区域风险热力图</span>
            <Space size={8}>
              <Typography.Text style={{ color: '#9fc7e8', fontSize: 12 }}>{currentRegion.label}</Typography.Text>
              <Button size="small" ghost icon={<ArrowLeftOutlined />} onClick={goBackMap} disabled={!currentRegion.parent}>上一级</Button>
              <Button size="small" ghost icon={<ReloadOutlined />} onClick={resetMap}>重置</Button>
              <Tag color="red">高风险资产 {highRiskAssets}</Tag>
              <Tag color="orange">同步失败 {syncSummary?.failed || 0}</Tag>
            </Space>
          </div>
          <div ref={mapRef} style={{ height: 'calc(100% - 36px)', minHeight: 470 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={panelStyle}>
            <div style={panelTitleStyle}>整改进度</div>
            <div ref={funnelRef} style={{ height: 190 }} />
          </div>
          <div style={panelStyle}>
            <div style={panelTitleStyle}>重点漏洞督办 <Tag color="red">{urgentVulns.length}</Tag></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {urgentVulns.map(vuln => (
                <div key={vuln.id} onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(vuln.cve || vuln.title)}`)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid rgba(143,180,216,.12)', paddingBottom: 8 }}>
                  <div style={{ color: '#fff', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vuln.cve || vuln.title}</div>
                  <Space size={6}>
                    <Tag color={riskColors[vuln.severity] || 'blue'}>{vuln.severity}</Tag>
                    {vuln.poc_status === 'verified' && <Tag color="red">POC命中</Tag>}
                    <Typography.Text style={{ color: '#7896b3', fontSize: 12 }}>{formatDate(vuln.last_found || vuln.created_at)}</Typography.Text>
                  </Space>
                </div>
              ))}
              {!urgentVulns.length && <Typography.Text style={{ color: '#7896b3' }}>暂无重点漏洞</Typography.Text>}
            </div>
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>暴露服务画像</div>
          <RankingList rows={topServices.map(item => ({ ...item, color: '#13c2c2' }))} />
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>近 14 日风险趋势</div>
          <div ref={trendRef} style={{ height: 185 }} />
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>同步与质量态势 <Tag color={syncSummary?.failed ? 'red' : 'green'}>{syncSummary?.success_rate || 0}%</Tag></div>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dcecff' }}>
                <span>同步成功率</span><strong>{syncSummary?.success_rate || 0}%</strong>
              </div>
              <Progress percent={syncSummary?.success_rate || 0} strokeColor="#34c759" trailColor="rgba(255,255,255,.08)" />
            </div>
            <Space wrap>
              <Tag color="green">成功 {syncSummary?.success || 0}</Tag>
              <Tag color="blue">运行 {syncSummary?.running || 0}</Tag>
              <Tag color="orange">等待 {syncSummary?.pending || 0}</Tag>
              <Tag color="red">失败 {syncSummary?.failed || 0}</Tag>
            </Space>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button ghost icon={<CloudSyncOutlined />} onClick={() => navigate('/dataops')}>同步任务</Button>
              <Button ghost icon={<DesktopOutlined />} onClick={() => navigate('/assets?quality_issue=missing_unit')}>未归属资产</Button>
            </div>
            <Typography.Text style={{ color: '#7896b3', fontSize: 12 }}>
              最近任务：{syncTasks?.[0]?.message || syncTasks?.[0]?.query_condition || '暂无同步任务'} / {formatTime(syncTasks?.[0]?.updated_at)}
            </Typography.Text>
          </Space>
        </div>

        <div style={{ ...panelStyle, gridColumn: '1 / span 3' }}>
          <div style={panelTitleStyle}>暴露端口 Top</div>
          <Space wrap>
            {topPorts.map(item => <Tag key={item.name} color="geekblue">{item.name} / {item.count}</Tag>)}
            {!topPorts.length && <Typography.Text style={{ color: '#7896b3' }}>暂无端口数据</Typography.Text>}
          </Space>
        </div>
      </div>
    </div>
  );
}

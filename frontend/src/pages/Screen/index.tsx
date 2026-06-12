import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Progress, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import {
  AlertOutlined,
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
import { EffectScatterChart, MapChart } from 'echarts/charts';
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import apiClient from '@/api/client';
import type { Asset, AssetQualityReport, DashboardData, SyncTask, SyncTaskSummary, Unit, Vulnerability } from '@/types';

echarts.use([MapChart, EffectScatterChart, TooltipComponent, VisualMapComponent, GeoComponent, CanvasRenderer]);

const CHINA_URL = '/maps/china.json';
const ANHUI_URL = '/maps/anhui.json';
const ANHUI_CITY_URL_PREFIX = '/maps/anhui-cities';

const geoCache: Record<string, any> = {};

type MapLevel = 'province' | 'city' | 'county';
type AlertKind = 'success' | 'info' | 'warning' | 'error';

interface MapRegion {
  level: MapLevel;
  mapName: string;
  label: string;
  url: string;
  parent?: MapRegion;
}

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

const PROVINCE_REGION: MapRegion = {
  level: 'province',
  mapName: 'china_province',
  label: '全国省级态势',
  url: CHINA_URL,
};

const severityColors: Record<string, string> = { 严重: 'red', 高危: 'orange', 中危: 'blue', 低危: 'green' };
const riskWeight: Record<string, number> = { 严重: 12, 高危: 8, 中危: 4, 低危: 1 };
const syncStatusColors: Record<string, string> = { success: 'green', failed: 'red', running: 'blue', pending: 'orange' };
const syncStatusLabels: Record<string, string> = { success: '成功', failed: '失败', running: '运行中', pending: '等待中' };
const MAP_AREA_COLORS = ['#e8f5f3', '#dbeafe', '#fef3c7', '#fed7aa', '#fecaca'];
const MAP_BORDER_COLOR = '#7fa8b8';
const MAP_EMPHASIS_COLOR = '#cdeee8';

async function loadGeoJSON(url: string, key: string): Promise<any> {
  if (geoCache[key]) return geoCache[key];
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed');
  const data = await resp.json();
  geoCache[key] = data;
  return data;
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

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function assetPoint(asset: AssetLocation) {
  const lng = Number(asset.longitude);
  const lat = Number(asset.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    name: asset.name || asset.ip,
    value: [lng, lat, Math.max(riskWeight[asset.risk] || 4, asset.vuln_count || 1)],
    asset,
  };
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
  if (score >= 30) return MAP_AREA_COLORS[4];
  if (score >= 16) return MAP_AREA_COLORS[3];
  if (score >= 6) return MAP_AREA_COLORS[2];
  if (score > 0) return MAP_AREA_COLORS[1];
  return MAP_AREA_COLORS[index % 2 === 0 ? 0 : 1];
}

function clusterColor(highAssets: number, assetCount: number) {
  if (highAssets >= 10) return '#ff4d4f';
  if (highAssets > 0) return '#fa8c16';
  if (assetCount >= 20) return '#1677ff';
  return '#13c2c2';
}

export default function Screen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRegion, setCurrentRegion] = useState<MapRegion>(PROVINCE_REGION);
  const [currentGeoJSON, setCurrentGeoJSON] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapMessage, setMapMessage] = useState('');
  const [mapAlertType, setMapAlertType] = useState<AlertKind>('info');

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
    queryKey: ['sync-tasks-screen'],
    queryFn: async () => { const { data } = await apiClient.get('/sync/tasks'); return data; },
    refetchInterval: 5000,
  });

  const { data: assetLocations, isFetched: assetLocationsFetched } = useQuery<AssetLocation[]>({
    queryKey: ['screen-asset-locations'],
    queryFn: async () => { const { data } = await apiClient.get('/dashboard/asset-locations'); return data; },
  });

  const unitNameById = useMemo(() => new Map((units || []).map(unit => [unit.id, unit.name])), [units]);
  const totalAssets = assets?.length ?? stats?.total_assets ?? 0;
  const unresolvedHigh = useMemo(
    () => (vulns || []).filter(v => ['严重', '高危'].includes(v.severity) && !['已修复', '误报', '接受风险'].includes(v.status)).length,
    [vulns],
  );
  const pocVerified = useMemo(() => (vulns || []).filter(v => v.poc_status === 'verified').length, [vulns]);
  const unassignedIssue = qualityReport?.issues?.find(issue => issue.key === 'missing_unit');
  const missingCoordinateIssue = qualityReport?.issues?.find(issue => issue.key === 'missing_coordinates');
  const topPorts = useMemo(() => topTokens((assets || []).flatMap(asset => splitTokens(asset.ports))), [assets]);
  const topServices = useMemo(() => topTokens((assets || []).flatMap(asset => splitTokens(asset.services))), [assets]);
  const criticalVulns = useMemo(
    () => (vulns || [])
      .filter(vuln => vuln.severity === '严重' || vuln.poc_status === 'verified')
      .sort((a, b) => (riskWeight[b.severity] || 0) - (riskWeight[a.severity] || 0))
      .slice(0, 6),
    [vulns],
  );
  const latestEvents = useMemo(() => {
    const assetEvents = (assets || []).slice(0, 8).map(asset => ({
      id: `asset-${asset.id}`,
      time: asset.last_seen || asset.created_at || '',
      type: '资产',
      title: `${asset.ip} ${asset.name}`,
      tag: asset.risk,
      color: severityColors[asset.risk] || 'blue',
      path: `/assets/${asset.id}`,
    }));
    const vulnEvents = (vulns || []).slice(0, 8).map(vuln => ({
      id: `vuln-${vuln.id}`,
      time: vuln.last_found || vuln.created_at || '',
      type: '漏洞',
      title: vuln.cve || vuln.title,
      tag: vuln.poc_status === 'verified' ? 'PoC命中' : vuln.severity,
      color: vuln.poc_status === 'verified' ? 'red' : (severityColors[vuln.severity] || 'orange'),
      path: `/vulnerabilities?q=${encodeURIComponent(vuln.cve || vuln.title)}`,
    }));
    const taskEvents = (syncTasks || []).slice(0, 8).map(task => ({
      id: `task-${task.id}`,
      time: task.updated_at || task.created_at || '',
      type: '同步',
      title: task.query_condition || task.message || task.id,
      tag: syncStatusLabels[task.status] || task.status,
      color: syncStatusColors[task.status] || 'default',
      path: '/dataops',
    }));
    return [...assetEvents, ...vulnEvents, ...taskEvents]
      .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime())
      .slice(0, 8);
  }, [assets, vulns, syncTasks]);

  useEffect(() => () => { chartRef.current?.dispose(); }, []);

  useEffect(() => {
    let canceled = false;
    const loadCurrentMap = async () => {
      setLoading(true);
      setMapMessage('');
      try {
        const geoJSON = await loadGeoJSON(currentRegion.url, currentRegion.mapName);
        if (canceled) return;
        setCurrentGeoJSON(geoJSON);
      } catch {
        if (canceled) return;
        setCurrentGeoJSON(null);
        setMapAlertType('error');
        setMapMessage(`地图数据加载失败，请检查 ${currentRegion.url} 是否可访问`);
        setLoading(false);
      }
    };
    loadCurrentMap();
    return () => { canceled = true; };
  }, [currentRegion]);

  useEffect(() => {
    if (currentGeoJSON) renderMap(currentGeoJSON, currentRegion);
  }, [currentGeoJSON, currentRegion, assetLocations, assetLocationsFetched]);

  useEffect(() => {
    const resizeChart = () => chartRef.current?.resize();
    const onFullscreenChange = () => {
      if (document.fullscreenElement === mapPanelRef.current) setIsFullscreen(true);
      if (!document.fullscreenElement) setIsFullscreen(false);
      setTimeout(resizeChart, 120);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('resize', resizeChart);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('resize', resizeChart);
    };
  }, []);

  const toggleMapFullscreen = async () => {
    const panel = mapPanelRef.current;
    if (!panel) return;
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement === panel) await document.exitFullscreen();
    } else {
      setIsFullscreen(true);
      try {
        await panel.requestFullscreen();
      } catch {
        // Browser fullscreen can be blocked; fixed-position expansion remains available.
      }
    }
    setTimeout(() => chartRef.current?.resize(), 120);
  };

  const drillToCityLevel = () => {
    setCurrentRegion({
      level: 'city',
      mapName: 'anhui_city',
      label: '安徽省市级态势',
      url: ANHUI_URL,
      parent: PROVINCE_REGION,
    });
  };

  const drillToCountyLevel = (name: string, adcode: number) => {
    setCurrentRegion({
      level: 'county',
      mapName: `anhui_county_${adcode}`,
      label: `${name}区县级态势`,
      url: `${ANHUI_CITY_URL_PREFIX}/${adcode}.json`,
      parent: currentRegion,
    });
  };

  const handleMapClick = (params: any) => {
    const data = params.data || {};
    const name = params.name || data.name || data.properties?.name;
    const adcode = Number(data.adcode || data.properties?.adcode);
    if (currentRegion.level === 'province') {
      if (name === '安徽省' || adcode === 340000 || params.seriesType === 'effectScatter') {
        drillToCityLevel();
        return;
      }
      setMapAlertType('info');
      setMapMessage('当前平台已接入安徽省区县地图，点击安徽省进入市级视图');
      return;
    }
    if (currentRegion.level === 'city' && Number.isFinite(adcode)) {
      drillToCountyLevel(name, adcode);
      return;
    }
  };

  const renderMap = (geoJSON: any, region: MapRegion) => {
    const dom = mapRef.current;
    if (!dom || !geoJSON) return;
    if (chartRef.current) chartRef.current.dispose();
    const chart = echarts.init(dom);
    chartRef.current = chart;
    echarts.registerMap(region.mapName, geoJSON);
    const points = (assetLocations || [])
      .map(asset => assetPoint(asset))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const areaData = geoJSON.features.map((feature: any, index: number) => {
      const assetsInArea = points.filter(point => featureContainsPoint(feature, [Number(point.value[0]), Number(point.value[1])]));
      const score = assetsInArea.reduce((sum, point) => sum + (riskWeight[point.asset.risk] || 1) + (point.asset.vuln_count || 0), 0);
      return {
        name: feature.properties.name,
        value: score,
        asset_count: assetsInArea.length,
        high_assets: assetsInArea.filter(point => ['严重', '高危'].includes(point.asset.risk)).length,
        vuln_count: assetsInArea.reduce((sum, point) => sum + (point.asset.vuln_count || 0), 0),
        top_assets: assetsInArea
          .sort((a, b) => ((riskWeight[b.asset.risk] || 0) + (b.asset.vuln_count || 0)) - ((riskWeight[a.asset.risk] || 0) + (a.asset.vuln_count || 0)))
          .slice(0, 5)
          .map(point => point.asset),
        adcode: feature.properties.adcode,
        properties: feature.properties,
        itemStyle: { areaColor: areaColor(score, index) },
      };
    });
    const clusterData = areaData
      .filter((item: any) => item.asset_count > 0)
      .map((item: any) => {
        const center = item.properties.centroid || item.properties.center;
        return {
          ...item,
          value: [Number(center?.[0]), Number(center?.[1]), item.value, item.asset_count],
          itemStyle: {
            color: clusterColor(item.high_assets, item.asset_count),
            borderColor: '#fff',
            borderWidth: 2,
            shadowBlur: 16,
            shadowColor: 'rgba(15, 23, 42, .22)',
          },
        };
      })
      .filter((item: any) => Number.isFinite(item.value[0]) && Number.isFinite(item.value[1]));

    chart.setOption({
      backgroundColor: '#f7faf9',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255,255,255,.96)',
        borderColor: '#d8e5e5',
        textStyle: { color: '#1f2937' },
        formatter: (params: any) => {
          if (params.seriesType === 'effectScatter') {
            const item = params.data || {};
            const topAssets = (item.top_assets || [])
              .map((asset: AssetLocation) => `${asset.ip} ${asset.risk} 漏洞${asset.vuln_count || 0}`)
              .join('<br/>');
            return [
              `<strong>${item.name}</strong>`,
              `资产数：${item.asset_count || 0}`,
              `高风险资产：${item.high_assets || 0}`,
              `关联漏洞：${item.vuln_count || 0}`,
              topAssets ? `Top资产：<br/>${topAssets}` : '',
            ].join('<br/>');
          }
          const item = params.data || {};
          const drillText = region.level === 'province'
            ? (params.name === '安徽省' ? '点击下钻到市级' : '当前仅安徽省可下钻')
            : region.level === 'city'
              ? '点击下钻到区县级'
              : '区县级态势';
          return [
            `<strong>${params.name}</strong>`,
            `资产点位：${item.asset_count || 0}`,
            `高风险资产：${item.high_assets || 0}`,
            `关联漏洞：${item.vuln_count || 0}`,
            drillText,
          ].join('<br/>');
        },
      },
      geo: {
        map: region.mapName,
        roam: true,
        zoom: region.level === 'province' ? 1 : 1.08,
        layoutCenter: ['50%', '51%'],
        layoutSize: region.level === 'province' ? '100%' : '92%',
        itemStyle: {
          areaColor: '#edf7f5',
          borderColor: MAP_BORDER_COLOR,
          borderWidth: 0.9,
          shadowBlur: 10,
          shadowColor: 'rgba(52, 97, 112, .14)',
        },
        emphasis: {
          label: { color: '#111827', fontWeight: 700 },
          itemStyle: { areaColor: MAP_EMPHASIS_COLOR, borderColor: '#00a6a6', borderWidth: 1.25 },
        },
        label: { show: true, color: '#415b66', fontSize: 9 },
      },
      series: [
        {
          name: '行政区态势',
          type: 'map',
          map: region.mapName,
          geoIndex: 0,
          data: areaData,
          itemStyle: {
            borderColor: MAP_BORDER_COLOR,
            borderWidth: 0.75,
          },
          emphasis: {
            itemStyle: {
              areaColor: MAP_EMPHASIS_COLOR,
              borderColor: '#00a6a6',
              borderWidth: 1.2,
            },
          },
        },
        {
          name: '资产聚合',
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: clusterData,
          symbolSize: (value: number[]) => Math.max(20, Math.min(56, Math.sqrt(Number(value[3]) || 1) * 6 + 14)),
          rippleEffect: { brushType: 'stroke', scale: 2.6 },
          label: {
            show: true,
            formatter: (params: any) => params.data.asset_count,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
          },
          zlevel: 2,
        },
      ],
    });
    chart.off('click');
    chart.on('click', handleMapClick);
    setLoading(false);
    if (assetLocationsFetched && !clusterData.length) {
      setMapAlertType('info');
      setMapMessage('当前资产暂无可用经纬度，已显示行政区划底图');
    }
    chart.resize();
  };

  const resetMap = () => {
    setMapMessage('');
    setCurrentRegion(PROVINCE_REGION);
  };

  const goBackMap = () => {
    if (!currentRegion.parent) return;
    setMapMessage('');
    setCurrentRegion(currentRegion.parent);
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['vulns'] });
    queryClient.invalidateQueries({ queryKey: ['asset-quality-report'] });
    queryClient.invalidateQueries({ queryKey: ['sync-task-summary'] });
    queryClient.invalidateQueries({ queryKey: ['sync-tasks-screen'] });
    queryClient.invalidateQueries({ queryKey: ['screen-asset-locations'] });
  };

  const kpis = [
    { label: '资产总数', value: totalAssets, color: '#1677ff', icon: <DesktopOutlined /> },
    { label: '单位覆盖', value: stats?.total_units ?? 0, color: '#34c759', icon: <BankOutlined /> },
    { label: '待处置高危', value: unresolvedHigh, color: '#ff4d4f', icon: <AlertOutlined /> },
    { label: 'PoC命中', value: pocVerified, color: '#fa541c', icon: <FireOutlined /> },
  ];

  return (
    <div style={{ minHeight: 'calc(100vh - 100px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <FundViewOutlined style={{ color: '#13c2c2', marginRight: 8 }} /> 区域作战指挥图
          </Typography.Title>
          <Typography.Text type="secondary">资产定位、单位风险、PoC 命中、同步质量联动展示</Typography.Text>
        </div>
        <Space>
          <Typography.Text type="secondary">更新时间：{new Date().toLocaleString('zh-CN')}</Typography.Text>
          <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
        </Space>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        {kpis.map(item => (
          <Card key={item.label} size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title={item.label}
              value={item.value}
              prefix={<span style={{ color: item.color }}>{item.icon}</span>}
              valueStyle={{ color: item.color, fontWeight: 700, fontSize: 26 }}
            />
          </Card>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 220px) minmax(500px, 1fr) minmax(200px, 220px)', gridTemplateRows: 'minmax(500px, 1fr) 190px', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="作战关注" size="small" style={{ borderRadius: 14 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography.Text>未归属资产</Typography.Text>
                  <Typography.Text strong>{unassignedIssue?.count || 0}</Typography.Text>
                </div>
                <Progress percent={unassignedIssue?.rate || 0} size="small" strokeColor="#faad14" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography.Text>缺经纬度资产</Typography.Text>
                  <Typography.Text strong>{missingCoordinateIssue?.count || 0}</Typography.Text>
                </div>
                <Progress percent={missingCoordinateIssue?.rate || 0} size="small" strokeColor="#1677ff" />
              </div>
              <Button block onClick={() => navigate('/dataops')}>进入数据质量闭环</Button>
            </Space>
          </Card>

          <Card title="暴露端口 Top" size="small" style={{ borderRadius: 14, flex: 1 }}>
            <Table
              size="small"
              pagination={false}
              dataSource={topPorts}
              rowKey="name"
              columns={[
                { title: '端口', dataIndex: 'name', render: value => <code>{value}</code> },
                { title: '资产', dataIndex: 'count', width: 74 },
              ]}
              locale={{ emptyText: '暂无端口数据' }}
            />
          </Card>

          <Card title="暴露服务 Top" size="small" style={{ borderRadius: 14, flex: 1 }}>
            <Table
              size="small"
              pagination={false}
              dataSource={topServices}
              rowKey="name"
              columns={[
                { title: '服务', dataIndex: 'name', ellipsis: true },
                { title: '资产', dataIndex: 'count', width: 74 },
              ]}
              locale={{ emptyText: '暂无服务数据' }}
            />
          </Card>
        </div>

        <div ref={mapPanelRef} style={{
          minWidth: 0,
          display: 'flex',
          background: isFullscreen ? '#f5f7fb' : undefined,
          padding: isFullscreen ? 16 : 0,
          position: isFullscreen ? 'fixed' : 'relative',
          inset: isFullscreen ? 0 : undefined,
          zIndex: isFullscreen ? 1000 : undefined,
          height: isFullscreen ? '100vh' : undefined,
          width: isFullscreen ? '100vw' : undefined,
        }}>
          <Card
            title={<span><FundViewOutlined style={{ color: '#13c2c2', marginRight: 8 }} />区域态势地图</span>}
            extra={(
              <Space size={8} wrap>
                <Typography.Text type="secondary">{currentRegion.label}</Typography.Text>
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={goBackMap} disabled={!currentRegion.parent}>上一级</Button>
                <Button size="small" icon={<ReloadOutlined />} onClick={resetMap}>重置</Button>
                <Button size="small" icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleMapFullscreen}>
                  {isFullscreen ? '退出全屏' : '全屏'}
                </Button>
              </Space>
            )}
            style={{ flex: 1, borderRadius: 14, height: '100%' }}
            styles={{ body: { height: 'calc(100% - 57px)', padding: 0, position: 'relative' } }}
          >
            {loading && <Spin size="large" style={{ position: 'absolute', top: '50%', left: '50%', zIndex: 10 }} />}
            {mapMessage && <Alert type={mapAlertType} message={mapMessage} showIcon style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 11 }} />}
            <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 480 }} />
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="高风险单位" size="small" style={{ borderRadius: 14, flex: 1 }}>
            <Table
              size="small"
              pagination={false}
              dataSource={stats?.top_risk_units || []}
              rowKey="id"
              columns={[
                { title: '单位', dataIndex: 'name', ellipsis: true },
                { title: '资产', dataIndex: 'asset_count', width: 58 },
                { title: '高危', key: 'risk', width: 74, render: (_, row: any) => <Tag color={row.critical_vuln ? 'red' : 'orange'}>{row.critical_vuln + row.high_vuln}</Tag> },
              ]}
              locale={{ emptyText: '暂无风险单位' }}
            />
          </Card>

          <Card title="PoC 命中与严重漏洞" size="small" style={{ borderRadius: 14, flex: 1 }}>
            <Table
              size="small"
              pagination={false}
              dataSource={criticalVulns}
              rowKey="id"
              columns={[
                { title: '漏洞', dataIndex: 'title', ellipsis: true, render: (value, row) => <a onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(row.cve || value)}`)}>{row.cve || value}</a> },
                { title: '等级', dataIndex: 'severity', width: 64, render: value => <Tag color={severityColors[value] || 'default'}>{value}</Tag> },
                { title: 'PoC', dataIndex: 'poc_status', width: 72, render: value => value === 'verified' ? <Tag color="red">命中</Tag> : value === 'available' ? <Tag color="orange">存在</Tag> : <Tag>无</Tag> },
              ]}
              locale={{ emptyText: '暂无严重漏洞' }}
            />
          </Card>

          <Card title="同步状态" size="small" style={{ borderRadius: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <Statistic title="成功率" value={syncSummary?.success_rate || 0} suffix="%" precision={1} valueStyle={{ fontSize: 22, color: '#34c759' }} />
              <Statistic title="失败任务" value={syncSummary?.failed || 0} valueStyle={{ fontSize: 22, color: '#ff4d4f' }} />
            </div>
            <Space wrap size={[4, 6]}>
              {(syncTasks || []).slice(0, 5).map(task => (
                <Tag key={task.id} color={syncStatusColors[task.status] || 'default'} icon={<CloudSyncOutlined />}>
                  {syncStatusLabels[task.status] || task.status}
                </Tag>
              ))}
              {!(syncTasks || []).length && <Typography.Text type="secondary">暂无同步任务</Typography.Text>}
            </Space>
          </Card>
        </div>

        <Card title="最新态势事件" size="small" style={{ borderRadius: 14, gridColumn: '1 / span 2' }}>
          <Table
            size="small"
            pagination={false}
            dataSource={latestEvents}
            rowKey="id"
            columns={[
              { title: '时间', dataIndex: 'time', width: 170, render: formatTime },
              { title: '类型', dataIndex: 'type', width: 70, render: value => <Tag>{value}</Tag> },
              { title: '事件', dataIndex: 'title', ellipsis: true, render: (value, row: any) => <a onClick={() => navigate(row.path)}>{value}</a> },
              { title: '状态', dataIndex: 'tag', width: 96, render: (value, row) => <Tag color={row.color}>{value}</Tag> },
            ]}
            locale={{ emptyText: '暂无态势事件' }}
          />
        </Card>

        <Card title="作战入口" size="small" style={{ borderRadius: 14 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button block icon={<DesktopOutlined />} onClick={() => navigate('/assets')}>资产清单</Button>
            <Button block icon={<SafetyOutlined />} onClick={() => navigate('/vulnerabilities?poc_status=verified')}>PoC 命中漏洞</Button>
            <Button block icon={<CloudSyncOutlined />} onClick={() => navigate('/dataops')}>同步任务中心</Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            地图支持省级、市级、区县级下钻；资产点位来自经纬度字段，缺失资产在数据质量页闭环修正。
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  );
}

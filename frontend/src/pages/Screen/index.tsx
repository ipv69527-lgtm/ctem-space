import { useEffect, useRef, useState } from 'react';
import { Alert, Card, Spin, Row, Col, Statistic, Table, Button } from 'antd';
import {
  FundViewOutlined,
  ReloadOutlined,
  BankOutlined,
  DesktopOutlined,
  WarningOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts/core';
import { EffectScatterChart, MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, GeoComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import apiClient from '@/api/client';
import type { Unit } from '@/types';

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

const PROVINCE_REGION: MapRegion = {
  level: 'province',
  mapName: 'china_province',
  label: '全国 — 省级资产分布',
  url: CHINA_URL,
};

const MAP_AREA_COLORS = ['#dff3ed', '#e4ebff', '#fff0cc', '#dff1ff', '#eaf4d3', '#f5e2ef'];
const MAP_BORDER_COLOR = '#7fa8b8';
const MAP_EMPHASIS_COLOR = '#cdeee8';
const ASSET_POINT_COLOR = '#ff6b35';

async function loadGeoJSON(url: string, key: string): Promise<any> {
  if (geoCache[key]) return geoCache[key];
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed');
  const data = await resp.json();
  geoCache[key] = data;
  return data;
}

interface AssetLocation {
  id: string;
  name: string;
  ip: string;
  risk: string;
  unit_id: string;
  unit_name: string;
  ports: string;
  services: string;
  vuln_count: number;
  longitude: number;
  latitude: number;
}

function assetPoint(asset: AssetLocation) {
  const lng = Number(asset.longitude);
  const lat = Number(asset.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const riskWeight: Record<string, number> = { 严重: 10, 高危: 8, 中危: 5, 低危: 2 };
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

function findFeatureByCoordinate(geoJSON: any, longitude: number, latitude: number) {
  if (!geoJSON?.features || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const point: [number, number] = [longitude, latitude];
  for (const feature of geoJSON.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon' && pointInPolygon(point, geometry.coordinates)) return feature;
    if (geometry.type === 'MultiPolygon' && geometry.coordinates.some((polygon: number[][][]) => pointInPolygon(point, polygon))) return feature;
  }
  return null;
}

export default function Screen() {
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRegion, setCurrentRegion] = useState<MapRegion>(PROVINCE_REGION);
  const [currentGeoJSON, setCurrentGeoJSON] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapMessage, setMapMessage] = useState('');
  const [mapAlertType, setMapAlertType] = useState<AlertKind>('info');

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => { const { data } = await apiClient.get('/dashboard/stats'); return data; },
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => { const { data } = await apiClient.get('/units/'); return data; },
  });

  const { data: assetLocations, isFetched: assetLocationsFetched } = useQuery<AssetLocation[]>({
    queryKey: ['screen-asset-locations'],
    queryFn: async () => { const { data } = await apiClient.get('/dashboard/asset-locations'); return data; },
  });

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
  }, [currentGeoJSON, currentRegion, assetLocations, assetLocationsFetched, units]);

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
      label: '安徽省 — 市级资产分布',
      url: ANHUI_URL,
      parent: PROVINCE_REGION,
    });
  };

  const drillToCountyLevel = (name: string, adcode: number) => {
    setCurrentRegion({
      level: 'county',
      mapName: `anhui_county_${adcode}`,
      label: `${name} — 区县级资产分布`,
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
    if (currentRegion.level === 'city' && params.seriesType === 'effectScatter') {
      const asset = data.asset;
      const feature = findFeatureByCoordinate(currentGeoJSON, Number(asset?.longitude), Number(asset?.latitude));
      const featureName = feature?.properties?.name;
      const featureAdcode = Number(feature?.properties?.adcode);
      if (featureName && Number.isFinite(featureAdcode)) drillToCountyLevel(featureName, featureAdcode);
    }
  };

  const renderMap = (geoJSON: any, region: MapRegion) => {
    const dom = mapRef.current; if (!dom || !geoJSON) return;
    if (chartRef.current) chartRef.current.dispose();
    const chart = echarts.init(dom); chartRef.current = chart;
    echarts.registerMap(region.mapName, geoJSON);
    const points = (assetLocations || [])
      .map(asset => assetPoint(asset))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const areaData = geoJSON.features.map((f: any, index: number) => ({
      name: f.properties.name,
      value: (index % MAP_AREA_COLORS.length) + 1,
      adcode: f.properties.adcode,
      properties: f.properties,
      itemStyle: {
        areaColor: MAP_AREA_COLORS[index % MAP_AREA_COLORS.length],
      },
    }));
    chart.setOption({
      backgroundColor: '#f7faf9',
      visualMap: {
        show: false,
        min: 1,
        max: MAP_AREA_COLORS.length,
        inRange: { color: MAP_AREA_COLORS },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(255,255,255,.96)',
        borderColor: '#d8e5e5',
        textStyle: { color: '#1f2937' },
        formatter: (params: any) => {
          if (params.seriesType === 'effectScatter') {
            const asset = params.data.asset;
            return [
              `<strong>${asset.name || asset.ip}</strong>`,
              `IP：${asset.ip}`,
              `单位：${asset.unit_name || '-'}`,
              `风险：${asset.risk}`,
              `端口：${asset.ports || '-'}`,
              `漏洞：${asset.vuln_count || 0} 个`,
              `坐标：${params.value[0]}, ${params.value[1]}`,
            ].join('<br/>');
          }
          if (region.level === 'province') {
            const tip = params.name === '安徽省' ? '点击下钻到市级' : '当前仅安徽省可下钻';
            return `${params.name}<br/>省级边界<br/>${tip}`;
          }
          if (region.level === 'city') return `${params.name}<br/>市级边界<br/>点击下钻到区县级`;
          return `${params.name}<br/>区县级边界`;
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
          name: '行政区划',
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
          name: '资产点位',
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: points,
          symbolSize: (value: number[]) => Math.max(9, Math.min(20, Number(value[2]) + 6)),
          rippleEffect: { brushType: 'stroke', scale: 3.2 },
          label: {
            show: true,
            formatter: (params: any) => params.data.asset.ip,
            position: 'right',
            color: '#0f172a',
            fontSize: 11,
            fontWeight: 600,
          },
          itemStyle: {
            color: ASSET_POINT_COLOR,
            shadowBlur: 14,
            shadowColor: 'rgba(255,107,53,.42)',
          },
          zlevel: 2,
        },
      ],
    });
    chart.off('click');
    chart.on('click', handleMapClick);
    setLoading(false);
    if (assetLocationsFetched && !points.length) {
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

  return (
    <div style={{ height: 'calc(100vh - 136px)', display: 'flex', gap: 20 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          ref={mapPanelRef}
          style={{
            flex: 1,
            display: 'flex',
            background: isFullscreen ? '#f5f7fb' : undefined,
            padding: isFullscreen ? 16 : 0,
            position: isFullscreen ? 'fixed' : 'relative',
            inset: isFullscreen ? 0 : undefined,
            zIndex: isFullscreen ? 1000 : undefined,
            height: isFullscreen ? '100vh' : undefined,
            width: isFullscreen ? '100vw' : undefined,
          }}
        >
          <Card title={<span><FundViewOutlined style={{ color: '#13c2c2', marginRight: 8 }} />区域态势地图</span>}
            extra={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ marginRight: 8, color: '#5f6368' }}>📍 {currentRegion.label}</span>
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={goBackMap} disabled={!currentRegion.parent}>上一级</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={resetMap}>重置地图</Button>
              <Button
                size="small"
                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={toggleMapFullscreen}
              >
                {isFullscreen ? '退出全屏' : '全屏'}
              </Button>
            </div>}
            style={{ flex: 1, borderRadius: 14, height: '100%' }}
            styles={{ body: { height: 'calc(100% - 57px)', padding: 0, position: 'relative' } }}>
            {loading && <Spin size="large" style={{ position: 'absolute', top: '50%', left: '50%', zIndex: 10 }} />}
            {mapMessage && <Alert type={mapAlertType} message={mapMessage} showIcon style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 11 }} />}
            <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />
          </Card>
        </div>
        <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4, textAlign: 'right' }}>点击下钻：省级 → 市级 → 区县级 · 资产经纬度落点 · 滚轮缩放 · 拖拽平移</div>
      </div>
      <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        <Row gutter={8}>
          {[{ label: '资产总数', value: stats?.total_assets ?? '-', color: '#007AFF', icon: <DesktopOutlined /> },
            { label: '活跃单位', value: stats?.total_units ?? '-', color: '#34C759', icon: <BankOutlined /> },
            { label: '漏洞总数', value: stats?.total_vulns ?? '-', color: '#FF9500', icon: <WarningOutlined /> },
            { label: '严重高危', value: stats?.critical_high ?? '-', color: '#FF3B30', icon: <WarningOutlined /> },
          ].map((s, i) => (
            <Col span={12} key={i} style={{ marginBottom: 8 }}>
              <Card size="small" style={{ borderRadius: 10, textAlign: 'center' }}>
                <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontWeight: 700, fontSize: 24 }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Card title="区域风险排名" size="small" style={{ borderRadius: 14 }}>
          <Table dataSource={(units || []).slice(0, 5)} rowKey="id" size="small" pagination={false}
            columns={[
              { title: '单位', dataIndex: 'name', key: 'name' },
              { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => v === 'active' ? '🟢' : '⚫' },
            ]} />
        </Card>
      </div>
    </div>
  );
}

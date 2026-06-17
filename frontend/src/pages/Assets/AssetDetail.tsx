import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Descriptions, Table, Tag, Spin, Card, Button, Collapse, Select, message, Row, Col, Statistic, Space } from 'antd';
import { DesktopOutlined, ArrowLeftOutlined, BankOutlined, CompassOutlined, SafetyOutlined, ApiOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { Asset, AssetChange, Unit, Vulnerability } from '@/types';

const VULN_STATUSES = ['待确认', '待整改', '整改中', '待复测', '已修复', '误报', '接受风险'];
const statusColors: Record<string, string> = {
  待确认: 'orange',
  待整改: 'volcano',
  整改中: 'blue',
  待复测: 'purple',
  已修复: 'green',
  误报: 'default',
  接受风险: 'cyan',
};

function formatChangeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ') || '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderChangeSummary(change: AssetChange) {
  if (change.action === 'create') return '首次入库';
  const entries = Object.entries(change.changes || {});
  if (!entries.length) return '-';
  return entries.map(([field, value]) => {
    const detail = value as { before?: unknown; after?: unknown };
    return `${field}: ${formatChangeValue(detail.before)} -> ${formatChangeValue(detail.after)}`;
  }).join('；');
}

function splitTokens(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function rawValue(asset: Asset, keys: string[]) {
  for (const item of asset.raw_data || []) {
    for (const key of keys) {
      const value = item[key];
      if (value !== null && value !== undefined && value !== '') return String(value);
    }
  }
  return '';
}

function rawValues(asset: Asset, keys: string[]) {
  const values: string[] = [];
  for (const item of asset.raw_data || []) {
    for (const key of keys) {
      const value = item[key];
      if (value !== null && value !== undefined && value !== '') values.push(String(value));
    }
  }
  return Array.from(new Set(values));
}

function appInfoValue(asset: Asset, keys: string[]) {
  for (const item of asset.raw_data || []) {
    const appInfo = item.application_info;
    const entries = Array.isArray(appInfo) ? appInfo : [];
    for (const app of entries) {
      if (!app || typeof app !== 'object') continue;
      const record = app as Record<string, unknown>;
      for (const key of keys) {
        const value = record[key];
        if (value !== null && value !== undefined && value !== '') return String(value);
      }
    }
  }
  return '';
}

function countBy<T extends string>(items: T[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function riskScore(asset: Asset, vulns: Vulnerability[]) {
  const base: Record<string, number> = { 严重: 80, 高危: 65, 中危: 45, 低危: 20 };
  const vulnScore = vulns.reduce((score, vuln) => {
    const weight: Record<string, number> = { 严重: 18, 高危: 12, 中危: 6, 低危: 2 };
    return score + (weight[vuln.severity] || 3);
  }, 0);
  return Math.min(100, (base[asset.risk] || 35) + vulnScore);
}

export default function AssetDetail() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: asset, isLoading } = useQuery<Asset>({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/assets/${assetId}`);
      return data;
    },
    enabled: !!assetId,
  });

  const { data: vulns } = useQuery<Vulnerability[]>({
    queryKey: ['asset-vulns', assetId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/vulnerabilities/?asset_id=${assetId}`);
      return data || [];
    },
    enabled: !!assetId,
  });

  const { data: changes } = useQuery<AssetChange[]>({
    queryKey: ['asset-changes', assetId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/assets/${assetId}/changes`);
      return data || [];
    },
    enabled: !!assetId,
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => {
      const { data } = await apiClient.get('/units/');
      return data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, status_note }: { id: string; status: string; status_note: string }) =>
      apiClient.patch(`/vulnerabilities/${id}/status`, { status, status_note }),
    onSuccess: () => {
      message.success('漏洞状态已更新');
      queryClient.invalidateQueries({ queryKey: ['asset-vulns', assetId] });
      queryClient.invalidateQueries({ queryKey: ['vulns'] });
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '20vh auto' }} />;
  if (!asset) return <Typography.Text type="danger">资产未找到</Typography.Text>;

  const riskColors: Record<string, string> = { '严重': 'red', '高危': 'orange', '中危': 'blue', '低危': 'green' };
  const currentVulns = vulns || [];
  const currentChanges = changes || [];
  const unit = (units || []).find(item => item.id === asset.unit_id);
  const ports = splitTokens(asset.ports);
  const services = splitTokens(asset.services);
  const longitude = asset.longitude ?? rawValue(asset, ['longitude', 'lng']);
  const latitude = asset.latitude ?? rawValue(asset, ['latitude', 'lat']);
  const manufacturer = asset.manufacturer || appInfoValue(asset, ['manufacturer', 'manufacturer_short']) || rawValue(asset, ['manufacturer']);
  const brand = asset.brand || appInfoValue(asset, ['brand']) || rawValue(asset, ['brand']);
  const model = asset.model || appInfoValue(asset, ['model']) || rawValue(asset, ['model']);
  const product = asset.product || appInfoValue(asset, ['name']) || rawValue(asset, ['product', 'app', 'title']);
  const country = asset.country || rawValue(asset, ['country']);
  const province = asset.province || rawValue(asset, ['province']);
  const city = asset.city || rawValue(asset, ['city']);
  const device = asset.device || rawValue(asset, ['device']);
  const deviceType = asset.device_type || rawValue(asset, ['device_type', 'category_sub']);
  const protocolValues = rawValues(asset, ['protocol']);
  const serviceValues = rawValues(asset, ['service']);
  const vulnSeverityCounts = countBy(currentVulns.map(vuln => vuln.severity));
  const vulnStatusCounts = countBy(currentVulns.map(vuln => vuln.status));
  const score = riskScore(asset, currentVulns);
  const rawItems = asset.raw_data || [];
  const rawSummary = rawItems.map((item, index) => ({
    key: index,
    ip: String(item.ip || '-'),
    port: String(item.port || '-'),
    service: String(item.service || '-'),
    protocol: String(item.protocol || '-'),
    title: String(item.title || item.name || '-'),
    manufacturer: String(item.manufacturer || appInfoValue(asset, ['manufacturer', 'manufacturer_short']) || '-'),
    product: String(item.product || item.app || '-'),
    location: String(item.city || item.province || item.location || '-'),
    date: String(item.date || item.last_update || '-'),
  }));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          <DesktopOutlined style={{ color: '#13c2c2', marginRight: 8 }} />
          {asset.name} <Tag color={riskColors[asset.risk]}>{asset.risk}</Tag>
        </Typography.Title>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/assets')}>返回资产列表</Button>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={6}>
          <Card size="small" style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="风险评分" value={score} suffix="/ 100" valueStyle={{ color: score >= 80 ? '#f5222d' : score >= 60 ? '#fa8c16' : '#1677ff', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small" style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="关联漏洞" value={currentVulns.length} valueStyle={{ color: currentVulns.length ? '#fa541c' : '#52c41a', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small" style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="开放端口" value={ports.length} valueStyle={{ color: ports.length ? '#1677ff' : '#8c8c8c', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small" style={{ borderRadius: 10, textAlign: 'center' }}>
            <Statistic title="原始记录" value={rawItems.length} valueStyle={{ color: '#13c2c2', fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} xl={8}>
          <Card title={<span><DesktopOutlined style={{ color: '#13c2c2', marginRight: 8 }} />基础画像</span>} style={{ borderRadius: 14, height: '100%' }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="资产名称">{asset.name}</Descriptions.Item>
            <Descriptions.Item label="IP 地址"><code>{asset.ip}</code></Descriptions.Item>
            <Descriptions.Item label="所属单位">
              {unit ? <a onClick={() => navigate(`/units/${unit.id}`)}>{unit.name}</a> : <Tag>未归属</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="资产类型">{asset.type || deviceType || '-'}</Descriptions.Item>
            <Descriptions.Item label="操作系统">{asset.os || rawValue(asset, ['os_family']) || '-'}</Descriptions.Item>
            <Descriptions.Item label="MAC 地址">{asset.mac ? <code>{asset.mac}</code> : '-'}</Descriptions.Item>
            <Descriptions.Item label="最近更新">{asset.last_seen ? new Date(asset.last_seen).toLocaleString('zh-CN') : '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={<span><ApiOutlined style={{ color: '#1677ff', marginRight: 8 }} />暴露面画像</span>} style={{ borderRadius: 14, height: '100%' }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="开放端口">
              <Space wrap size={[4, 4]}>{ports.length ? ports.map(port => <Tag key={port} color="blue">{port}</Tag>) : '-'}</Space>
            </Descriptions.Item>
            <Descriptions.Item label="服务">
              <Space wrap size={[4, 4]}>{services.length ? services.map(service => <Tag key={service} color="cyan">{service}</Tag>) : '-'}</Space>
            </Descriptions.Item>
            <Descriptions.Item label="协议">
              <Space wrap size={[4, 4]}>{protocolValues.length ? protocolValues.map(protocol => <Tag key={protocol}>{protocol}</Tag>) : '-'}</Space>
            </Descriptions.Item>
            <Descriptions.Item label="RaySpace 服务">
              <Space wrap size={[4, 4]}>{serviceValues.length ? serviceValues.map(service => <Tag key={service}>{service}</Tag>) : '-'}</Space>
            </Descriptions.Item>
            <Descriptions.Item label="运营商">{asset.isp || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title={<span><CompassOutlined style={{ color: '#52c41a', marginRight: 8 }} />指纹与定位</span>} style={{ borderRadius: 14, height: '100%' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="厂商">{manufacturer || '-'}</Descriptions.Item>
              <Descriptions.Item label="品牌/型号">{[brand, model].filter(Boolean).join(' / ') || '-'}</Descriptions.Item>
              <Descriptions.Item label="产品/应用">{product || '-'}</Descriptions.Item>
              <Descriptions.Item label="设备">{device || deviceType || '-'}</Descriptions.Item>
              <Descriptions.Item label="行政位置">{[country, province, city].filter(Boolean).join(' / ') || asset.location || '-'}</Descriptions.Item>
              <Descriptions.Item label="经纬度">{longitude && latitude ? <code>{longitude}, {latitude}</code> : '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card title={<span><SafetyOutlined style={{ color: '#fa541c', marginRight: 8 }} />风险与处置概览</span>} style={{ borderRadius: 14, marginBottom: 16 }}>
        <Row gutter={[16, 12]}>
          <Col xs={24} md={12}>
            <Typography.Text strong>漏洞等级分布</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {['严重', '高危', '中危', '低危'].map(level => (
                <Tag key={level} color={riskColors[level]} style={{ marginBottom: 6 }}>{level}：{vulnSeverityCounts[level] || 0}</Tag>
              ))}
            </div>
          </Col>
          <Col xs={24} md={12}>
            <Typography.Text strong>处置状态分布</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {VULN_STATUSES.map(status => (
                <Tag key={status} color={statusColors[status] || 'default'} style={{ marginBottom: 6 }}>{status}：{vulnStatusCounts[status] || 0}</Tag>
              ))}
            </div>
          </Col>
        </Row>
      </Card>

      <Card title={`关联漏洞（${vulns?.length || 0}）`} style={{ borderRadius: 14 }}>
        <Table
          dataSource={vulns || []}
          rowKey="id"
          columns={[
            { title: '漏洞名称', dataIndex: 'title', key: 'title', width: 280, render: (v: string, r: Vulnerability) => <a onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(r.cve || v)}`)}><strong>{v}</strong></a> },
            { title: 'CVE', dataIndex: 'cve', key: 'cve', render: (v: string) => v ? <a onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(v)}`)}><code>{v}</code></a> : '-' },
            {
              title: '漏洞描述',
              dataIndex: 'desc',
              key: 'desc',
              width: 260,
              render: (v: string) => (
                <Typography.Text ellipsis={{ tooltip: v || '-' }} style={{ maxWidth: 240 }}>
                  {v || '-'}
                </Typography.Text>
              ),
            },
            { title: 'CVSS', dataIndex: 'cvss', key: 'cvss', width: 90, render: (v: number) => <span style={{ fontWeight: 700, color: v >= 9 ? '#ea4335' : '#333' }}>{v?.toFixed(1)}</span> },
            { title: '等级', dataIndex: 'severity', key: 'severity', render: (v: string) => <Tag color={riskColors[v] || 'default'}>{v}</Tag> },
            { title: '最近发现', dataIndex: 'last_found', key: 'last_found', width: 120, render: (v: string|null) => v ? new Date(v).toLocaleDateString('zh-CN') : '-' },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (v: string) => <Tag color={statusColors[v] || 'default'}>{v}</Tag>,
            },
            {
              title: '处置',
              key: 'action',
              width: 140,
              render: (_: unknown, r: Vulnerability) => (
                <Select
                  size="small"
                  value={r.status}
                  style={{ width: 110 }}
                  options={VULN_STATUSES.map(value => ({ value, label: value }))}
                  onChange={status => statusMutation.mutate({ id: r.id, status, status_note: r.status_note || '' })}
                />
              ),
            },
          ]}
          scroll={{ x: 1180 }}
          locale={{ emptyText: '该资产暂无关联漏洞' }}
        />
      </Card>

      <Card title={`资产变更历史（${changes?.length || 0}）`} style={{ borderRadius: 14, marginTop: 16 }}>
        <Table
          dataSource={changes || []}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            {
              title: '时间',
              dataIndex: 'created_at',
              width: 180,
              render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
            },
            {
              title: '动作',
              dataIndex: 'action',
              width: 100,
              render: (v: string) => <Tag color={v === 'create' ? 'green' : 'blue'}>{v === 'create' ? '新增' : '更新'}</Tag>,
            },
            { title: '来源', dataIndex: 'source', width: 120 },
            { title: '变更内容', key: 'summary', ellipsis: true, render: (_: unknown, r: AssetChange) => renderChangeSummary(r) },
          ]}
          expandable={{
            expandedRowRender: (record: AssetChange) => (
              <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(record.changes, null, 2)}
              </pre>
            ),
          }}
          locale={{ emptyText: '暂无资产变更记录' }}
        />
      </Card>

      <Card title={`RaySpace 原始数据（${rawItems.length} 条）`} style={{ borderRadius: 14, marginTop: 16 }}>
        <Table
          dataSource={rawSummary}
          rowKey="key"
          size="small"
          pagination={false}
          columns={[
            { title: 'IP', dataIndex: 'ip', render: (v: string) => <code>{v}</code> },
            { title: '端口', dataIndex: 'port', render: (v: string) => <code>{v}</code> },
            { title: '服务', dataIndex: 'service' },
            { title: '协议', dataIndex: 'protocol' },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            { title: '厂商', dataIndex: 'manufacturer', ellipsis: true },
            { title: '产品', dataIndex: 'product', ellipsis: true },
            { title: '位置', dataIndex: 'location', ellipsis: true },
            { title: '时间', dataIndex: 'date', ellipsis: true },
          ]}
          scroll={{ x: 1000 }}
          locale={{ emptyText: '暂无 RaySpace 原始数据' }}
        />
        <Collapse
          size="small"
          style={{ marginTop: 12 }}
          items={[{
            key: 'raw-json',
            label: '原始 JSON',
            children: (
              <pre style={{ margin: 0, maxHeight: 360, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(rawItems, null, 2)}
              </pre>
            ),
          }]}
        />
      </Card>
    </>
  );
}

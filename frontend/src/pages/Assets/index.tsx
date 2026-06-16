import { Alert, Typography, Table, Spin, Tag, Input, Select, Space, Button, Popover, Checkbox, Tooltip, Modal, Form, message, DatePicker } from 'antd';
import { ApartmentOutlined, CloudDownloadOutlined, DesktopOutlined, EditOutlined, FolderOpenOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState, type Key } from 'react';
import dayjs from 'dayjs';
import apiClient from '@/api/client';
import type { Asset, PaginatedResponse, SyncQueryTemplate, Unit } from '@/types';
import { useAuthStore } from '@/stores/authStore';

const ASSET_VISIBLE_COLUMNS_KEY = 'ctem.asset.visibleColumns';
const DEFAULT_VISIBLE_COLUMNS = ['name', 'ip', 'unit_name', 'type', 'ports', 'risk', 'location', 'last_seen'];
const RAW_BACKED_COLUMNS = new Set(['raw_count']);
const QUALITY_ISSUE_OPTIONS = [
  { value: 'missing_unit', label: '未归属' },
  { value: 'missing_ports', label: '缺端口' },
  { value: 'missing_location', label: '缺位置' },
  { value: 'missing_coordinates', label: '缺经纬度' },
  { value: 'missing_manufacturer', label: '缺厂商/品牌/型号' },
  { value: 'missing_raw', label: '缺原始数据' },
];
const QUALITY_ISSUE_META: Record<string, { label: string; description: string; action: string }> = {
  missing_unit: {
    label: '未归属资产',
    description: '这些资产没有关联单位，可勾选后批量归属，或进入资产详情逐条修正。',
    action: '勾选资产后批量归属',
  },
  missing_ports: {
    label: '缺端口资产',
    description: '这些资产缺少开放端口信息，可编辑资产补录，或调整 RaySpace 查询条件后重新同步。',
    action: '编辑资产补端口',
  },
  missing_location: {
    label: '缺位置资产',
    description: '这些资产缺少区域位置，会影响区域统计和地图展示，可编辑资产补充位置。',
    action: '编辑资产补位置',
  },
  missing_coordinates: {
    label: '缺经纬度资产',
    description: '这些资产无法在区域态势地图上落点，可编辑资产或修正 RaySpace 经纬度字段映射。',
    action: '补充经纬度来源',
  },
  missing_manufacturer: {
    label: '缺厂商/品牌/型号资产',
    description: '这些资产缺少厂商画像字段，可核对 application_info 或人工修正资产画像。',
    action: '补充厂商画像',
  },
  missing_raw: {
    label: '缺原始数据资产',
    description: '这些资产缺少 RaySpace 原始记录，建议检查同步任务和接口返回。',
    action: '查看同步任务',
  },
};

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    return String(value);
  }
  return '';
}

function rawItems(asset: Asset) {
  return Array.isArray(asset.raw_data) ? asset.raw_data : [];
}

function rawValue(asset: Asset, keys: string[]) {
  for (const item of rawItems(asset)) {
    for (const key of keys) {
      const value = item[key];
      if (value !== null && value !== undefined && value !== '') return String(value);
    }
  }
  return '';
}

function appInfoValue(asset: Asset, keys: string[]) {
  for (const item of rawItems(asset)) {
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

function loadVisibleColumns() {
  try {
    const raw = window.localStorage.getItem(ASSET_VISIBLE_COLUMNS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // ignore malformed local preference
  }
  return DEFAULT_VISIBLE_COLUMNS;
}

function listFromText(value: unknown) {
  return String(value || '')
    .split(/[,，;；\s\n\r]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeQueryValues(values: any) {
  const timeRange = Array.isArray(values.time_range) ? values.time_range : [];
  return {
    unit_id: values.unit_id || null,
    advanced_query: values.advanced_query || '',
    startdate: timeRange[0] ? timeRange[0].format('YYYY-MM-DD HH:mm:ss') : '',
    enddate: timeRange[1] ? timeRange[1].format('YYYY-MM-DD HH:mm:ss') : '',
    province: values.province || '',
    city: values.city || '',
    county: values.county || '',
    country: values.country || '',
    domain: values.domain || '',
    ip: values.ip || '',
    ports: listFromText(values.ports),
    protocol: values.protocol || '',
    service: values.service || '',
    status: values.status || '',
    asn: values.asn || '',
    isp: values.isp || '',
    category: values.category || '',
    category_main: values.category_main || '',
    category_sub: values.category_sub || '',
    device_type: values.device_type || '',
    device_category: values.device_category || '',
    os_type: values.os_type || '',
    os: values.os || '',
    support_type: values.support_type || '',
    support_category: values.support_category || '',
    support_service: values.support_service || '',
    middleware: values.middleware || '',
    product: values.product || '',
    title: values.title || '',
    banner: values.banner || '',
    header: values.header || '',
    body: values.body || '',
    server: values.server || '',
    http_status: values.http_status || '',
    cve: values.cve || '',
    cve_name: values.cve_name || '',
    poc: values.poc || '',
    tag: values.tag || '',
    custom_tag: values.custom_tag || '',
    industry: values.industry || '',
    dept: values.dept || '',
    ip_company_full: values.ip_company_full || '',
    keyword: values.keyword || '',
  };
}

function templateToFormValues(payload: Record<string, unknown>) {
  const values: Record<string, unknown> = { ...payload };
  if (values.startdate || values.enddate) {
    values.time_range = [
      values.startdate ? dayjs(String(values.startdate)) : null,
      values.enddate ? dayjs(String(values.enddate)) : null,
    ];
  }
  delete values.startdate;
  delete values.enddate;
  for (const key of ['ports', 'domain', 'ip', 'cve', 'tag', 'custom_tag']) {
    if (Array.isArray(values[key])) values[key] = (values[key] as unknown[]).join(',');
  }
  return values;
}

export default function Assets() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState('');
  const [risk, setRisk] = useState('');
  const [port, setPort] = useState('');
  const [service, setService] = useState('');
  const [location, setLocation] = useState('');
  const [hasVulns, setHasVulns] = useState('');
  const [qualityIssue, setQualityIssue] = useState(searchParams.get('quality_issue') || '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(loadVisibleColumns);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Key[]>([]);
  const [batchUnitOpen, setBatchUnitOpen] = useState(false);
  const [queryModalOpen, setQueryModalOpen] = useState(false);
  const [previewQuery, setPreviewQuery] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [form] = Form.useForm();
  const [batchUnitForm] = Form.useForm();
  const [queryForm] = Form.useForm();
  const [saveTemplateForm] = Form.useForm();
  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'operator';

  useEffect(() => {
    const nextQ = searchParams.get('q') || '';
    const nextUnitId = searchParams.get('unit_id') || '';
    const nextQualityIssue = searchParams.get('quality_issue') || '';
    setQ(nextQ);
    setUnitId(nextUnitId);
    setQualityIssue(nextQualityIssue);
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [q, unitId, type, risk, port, service, location, hasVulns, qualityIssue]);

  const includeRaw = Boolean(
    visibleColumnKeys.some(key => RAW_BACKED_COLUMNS.has(key))
  );

  const { data: assetsPage, isLoading, refetch } = useQuery<PaginatedResponse<Asset>>({
    queryKey: ['assets', q, unitId, type, risk, port, service, location, hasVulns, qualityIssue, page, pageSize, includeRaw],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      params.set('include_raw', includeRaw ? 'true' : 'false');
      if (q) params.set('q', q);
      if (unitId) params.set('unit_id', unitId);
      if (type) params.set('type', type);
      if (risk) params.set('risk', risk);
      if (port) params.set('port', port);
      if (service) params.set('service', service);
      if (location) params.set('location', location);
      if (hasVulns) params.set('has_vulns', hasVulns);
      if (qualityIssue) params.set('quality_issue', qualityIssue);
      const { data } = await apiClient.get('/assets/?' + params.toString());
      return data;
    },
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => {
      const { data } = await apiClient.get('/units/');
      return data;
    },
  });

  const { data: queryTemplates } = useQuery<SyncQueryTemplate[]>({
    queryKey: ['sync-query-templates'],
    queryFn: async () => {
      const { data } = await apiClient.get('/sync/query-templates');
      return data;
    },
    enabled: canEdit,
  });

  const unitNameById = new Map((units || []).map(unit => [unit.id, unit.name]));
  const assets = assetsPage?.items || [];
  const assetTotal = assetsPage?.total || 0;
  const hasFilters = Boolean(q || unitId || type || risk || port || service || location || hasVulns || qualityIssue);
  const activeQualityIssue = qualityIssue ? QUALITY_ISSUE_META[qualityIssue] : null;
  const unitOptions = [
    { value: '__unassigned', label: '未归属' },
    ...(units || []).map(unit => ({ value: unit.id, label: unit.name })),
  ];

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.put(`/assets/${id}`, body),
    onSuccess: (res) => {
      message.success('资产信息已保存');
      setEditingAsset(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', res.data.id] });
      queryClient.invalidateQueries({ queryKey: ['asset-changes', res.data.id] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '保存失败'),
  });

  const batchUnitMutation = useMutation({
    mutationFn: (values: any) => apiClient.post('/assets/batch/unit', {
      asset_ids: selectedAssetIds.map(String),
      unit_id: values.unit_id || null,
    }),
    onSuccess: (res: any) => {
      message.success(`批量归属完成，变更 ${res.data?.changed || 0} 个资产`);
      setBatchUnitOpen(false);
      setSelectedAssetIds([]);
      batchUnitForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset-quality-report'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '批量归属失败'),
  });

  const previewMutation = useMutation({
    mutationFn: (values: any) => apiClient.post('/sync/query-preview', normalizeQueryValues(values)),
    onSuccess: (res: any) => setPreviewQuery(res.data?.query_condition || ''),
    onError: (err: any) => message.error(err.response?.data?.detail || '查询条件生成失败'),
  });

  const triggerQueryMutation = useMutation({
    mutationFn: (values: any) => apiClient.post('/sync/query-trigger', normalizeQueryValues(values)),
    onSuccess: (res: any) => {
      message.success(res.data?.message || '条件拉取任务已提交');
      setQueryModalOpen(false);
      setPreviewQuery('');
      queryForm.resetFields();
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      }, 3000);
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '条件拉取任务提交失败'),
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (values: { name: string; desc: string; query_payload: Record<string, unknown> }) => apiClient.post('/sync/query-templates', values),
    onSuccess: () => {
      message.success('同步条件模板已保存');
      setSaveTemplateOpen(false);
      saveTemplateForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['sync-query-templates'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '模板保存失败'),
  });

  const resetFilters = () => {
    setQ('');
    setUnitId('');
    setType('');
    setRisk('');
    setPort('');
    setService('');
    setLocation('');
    setHasVulns('');
    setQualityIssue('');
  };

  const setVisibleColumns = (keys: string[]) => {
    const next = keys.length ? keys : ['name', 'ip'];
    setVisibleColumnKeys(next);
    window.localStorage.setItem(ASSET_VISIBLE_COLUMNS_KEY, JSON.stringify(next));
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    form.setFieldsValue({
      name: asset.name,
      ip: asset.ip,
      mac: asset.mac,
      type: asset.type,
      os: asset.os,
      risk: asset.risk,
      unit_id: asset.unit_id,
      ports: asset.ports,
      services: asset.services,
      location: asset.location,
      isp: asset.isp,
    });
  };

  const closeEditModal = () => {
    setEditingAsset(null);
    form.resetFields();
  };

  const submitAsset = (values: any) => {
    if (!editingAsset) return;
    updateMutation.mutate({ id: editingAsset.id, body: values });
  };

  const loadQueryTemplate = () => {
    const template = (queryTemplates || []).find(item => item.id === selectedTemplateId);
    if (!template) {
      message.warning('请选择同步条件模板');
      return;
    }
    queryForm.setFieldsValue(templateToFormValues(template.query_payload || {}));
    setPreviewQuery(template.query_condition || '');
  };

  const submitQueryTemplate = async () => {
    const [templateValues, queryValues] = await Promise.all([saveTemplateForm.validateFields(), queryForm.validateFields()]);
    saveTemplateMutation.mutate({
      name: templateValues.name,
      desc: templateValues.desc || '',
      query_payload: normalizeQueryValues(queryValues),
    });
  };

  const allColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (v: string, r: Asset) => <a onClick={() => navigate(`/assets/${r.id}`)}>{v}</a> },
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v: string) => <code>{v}</code> },
    { title: '单位名称', dataIndex: 'unit_id', key: 'unit_name', render: (v: string | null) => v ? (unitNameById.get(v) || '-') : <Tag>未归属</Tag> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '端口', dataIndex: 'ports', key: 'ports', ellipsis: true, render: (v: string) => v ? <code>{v}</code> : '-' },
    { title: '服务', dataIndex: 'services', key: 'services', ellipsis: true, render: (v: string) => v || '-' },
    { title: '风险', dataIndex: 'risk', key: 'risk', render: (v: string) => {
      const colors: Record<string, string> = { '严重': 'red', '高危': 'orange', '中危': 'blue', '低危': 'green' };
      return <Tag color={colors[v] || 'default'}>{v}</Tag>;
    }},
    { title: '位置', dataIndex: 'location', key: 'location' },
    { title: '运营商', dataIndex: 'isp', key: 'isp', render: (v: string) => v || '-' },
    { title: 'MAC', dataIndex: 'mac', key: 'mac', render: (v: string) => v ? <code>{v}</code> : '-' },
    { title: '操作系统', dataIndex: 'os', key: 'os', ellipsis: true, render: (v: string, r: Asset) => v || rawValue(r, ['os_family']) || '-' },
    { title: '国家', key: 'country', render: (_: unknown, r: Asset) => r.country || rawValue(r, ['country']) || '-' },
    { title: '省份', key: 'province', render: (_: unknown, r: Asset) => r.province || rawValue(r, ['province']) || '-' },
    { title: '城市', key: 'city', render: (_: unknown, r: Asset) => r.city || rawValue(r, ['city']) || '-' },
    { title: '经度', key: 'longitude', render: (_: unknown, r: Asset) => r.longitude ?? (rawValue(r, ['longitude', 'lng']) || '-') },
    { title: '纬度', key: 'latitude', render: (_: unknown, r: Asset) => r.latitude ?? (rawValue(r, ['latitude', 'lat']) || '-') },
    { title: '厂商', key: 'manufacturer', ellipsis: true, render: (_: unknown, r: Asset) => r.manufacturer || appInfoValue(r, ['manufacturer', 'manufacturer_short']) || rawValue(r, ['manufacturer']) || '-' },
    { title: '品牌', key: 'brand', render: (_: unknown, r: Asset) => r.brand || appInfoValue(r, ['brand']) || rawValue(r, ['brand']) || '-' },
    { title: '型号', key: 'model', render: (_: unknown, r: Asset) => r.model || appInfoValue(r, ['model']) || rawValue(r, ['model']) || '-' },
    { title: '应用/产品', key: 'product', ellipsis: true, render: (_: unknown, r: Asset) => r.product || appInfoValue(r, ['name']) || rawValue(r, ['product', 'app']) || '-' },
    { title: '设备', key: 'device', ellipsis: true, render: (_: unknown, r: Asset) => r.device || rawValue(r, ['device']) || '-' },
    { title: '设备类型', key: 'device_type', render: (_: unknown, r: Asset) => r.device_type || rawValue(r, ['device_type']) || '-' },
    { title: '漏洞数', key: 'vuln_count', render: (_: unknown, r: Asset) => <span style={{ color: '#1677ff', fontWeight: 600 }}>{r.vuln_ids?.length || 0}</span> },
    { title: '原始记录', key: 'raw_count', render: (_: unknown, r: Asset) => rawItems(r).length },
    { title: '最近发现', dataIndex: 'last_seen', key: 'last_seen', render: (v: string|null) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string|null) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
  ];
  const columns = [
    ...allColumns.filter(column => visibleColumnKeys.includes(String(column.key))),
    ...(canEdit ? [{
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 90,
      render: (_: unknown, r: Asset) => <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>编辑</Button>,
    }] : []),
  ];
  const columnOptions = allColumns.map(column => ({ label: String(column.title), value: String(column.key) }));
  const columnConfig = (
    <div style={{ width: 260 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <Typography.Text strong>显示列</Typography.Text>
        <Button size="small" type="link" onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}>恢复默认</Button>
      </div>
      <Checkbox.Group
        value={visibleColumnKeys}
        options={columnOptions}
        onChange={values => setVisibleColumns(values.map(String))}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px' }}
      />
    </div>
  );

  return (
    <>
      <Typography.Title level={3} style={{ marginBottom: 24 }}><DesktopOutlined style={{ color: '#13c2c2', marginRight: 8 }} /> 资产管理</Typography.Title>
      {activeQualityIssue && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${activeQualityIssue.label}：${assetTotal} 个`}
          description={
            <Space direction="vertical" size={8}>
              <Typography.Text>{activeQualityIssue.description}</Typography.Text>
              <Space wrap>
                {canEdit && qualityIssue === 'missing_unit' && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<ApartmentOutlined />}
                    disabled={!selectedAssetIds.length}
                    onClick={() => setBatchUnitOpen(true)}
                  >
                    批量归属{selectedAssetIds.length ? `（${selectedAssetIds.length}）` : ''}
                  </Button>
                )}
                {qualityIssue === 'missing_raw' && (
                  <Button size="small" onClick={() => navigate('/dataops')}>查看同步任务</Button>
                )}
                <Button size="small" onClick={() => navigate('/dataops')}>返回数据质量页</Button>
                <Button size="small" onClick={() => refetch()}>重新检查</Button>
              </Space>
            </Space>
          }
        />
      )}
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined />} placeholder="IP/名称/端口/服务..." value={q} onChange={e => setQ(e.target.value)}
          style={{ width: 240, borderRadius: 10 }} allowClear />
        <Select placeholder="单位名称" value={unitId || undefined} onChange={value => setUnitId(value || '')} style={{ width: 180 }} allowClear
          options={unitOptions} showSearch optionFilterProp="label" />
        <Select placeholder="类型" value={type || undefined} onChange={value => setType(value || '')} style={{ width: 130 }} allowClear
          options={['服务器','网络设备','安全设备','工控设备'].map(v=>({value:v,label:v}))} />
        <Select placeholder="风险等级" value={risk || undefined} onChange={value => setRisk(value || '')} style={{ width: 130 }} allowClear
          options={['严重','高危','中危','低危'].map(v=>({value:v,label:v}))} />
        <Input placeholder="端口" value={port} onChange={e => setPort(e.target.value)} style={{ width: 110, borderRadius: 10 }} allowClear />
        <Input placeholder="服务" value={service} onChange={e => setService(e.target.value)} style={{ width: 130, borderRadius: 10 }} allowClear />
        <Input placeholder="位置" value={location} onChange={e => setLocation(e.target.value)} style={{ width: 130, borderRadius: 10 }} allowClear />
        <Select placeholder="漏洞" value={hasVulns || undefined} onChange={value => setHasVulns(value || '')} style={{ width: 130 }} allowClear
          options={[{ value: 'yes', label: '有关联漏洞' }, { value: 'no', label: '无关联漏洞' }]} />
        <Select placeholder="质量项" value={qualityIssue || undefined} onChange={value => setQualityIssue(value || '')} style={{ width: 170 }} allowClear
          options={QUALITY_ISSUE_OPTIONS} />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>刷新</Button>
        {canEdit && <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setQueryModalOpen(true)}>条件拉取</Button>}
        {canEdit && (
          <Button
            icon={<ApartmentOutlined />}
            disabled={!selectedAssetIds.length}
            onClick={() => setBatchUnitOpen(true)}
          >
            批量归属{selectedAssetIds.length ? `（${selectedAssetIds.length}）` : ''}
          </Button>
        )}
        {activeQualityIssue && <Tag color="orange">{activeQualityIssue.action}</Tag>}
        <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
        <Popover content={columnConfig} trigger="click" placement="bottomRight">
          <Tooltip title="列配置">
            <Button icon={<SettingOutlined />} />
          </Tooltip>
        </Popover>
      </Space>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={assets} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          rowSelection={canEdit ? { selectedRowKeys: selectedAssetIds, onChange: setSelectedAssetIds } : undefined}
          scroll={{ x: 1180 }}
          pagination={{
            current: page,
            pageSize,
            total: assetTotal,
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: hasFilters ? '未找到匹配的资产' : '暂无资产数据，请先同步 Space 数据' }} />
      )}

      <Modal
        title="批量归属资产"
        open={batchUnitOpen}
        onCancel={() => { setBatchUnitOpen(false); batchUnitForm.resetFields(); }}
        onOk={() => batchUnitForm.submit()}
        confirmLoading={batchUnitMutation.isPending}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          已选择 {selectedAssetIds.length} 个资产。选择单位后会覆盖当前归属；不选择单位则清空归属。
        </Typography.Paragraph>
        <Form form={batchUnitForm} layout="vertical" onFinish={(values) => batchUnitMutation.mutate(values)}>
          <Form.Item name="unit_id" label="目标单位">
            <Select
              placeholder="清空归属"
              showSearch
              allowClear
              optionFilterProp="label"
              options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑资产"
        open={!!editingAsset}
        onCancel={closeEditModal}
        onOk={() => form.submit()}
        confirmLoading={updateMutation.isPending}
        width={760}
      >
        <Form form={form} layout="vertical" onFinish={submitAsset}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="name" label="资产名称" rules={[{ required: true, message: '请输入资产名称' }]}>
              <Input placeholder="资产名称" />
            </Form.Item>
            <Form.Item name="ip" label="IP 地址" rules={[{ required: true, message: '请输入 IP 地址' }]}>
              <Input placeholder="如：192.168.1.10" />
            </Form.Item>
            <Form.Item name="unit_id" label="所属单位">
              <Select
                placeholder="未选择则保持未归属"
                showSearch
                allowClear
                optionFilterProp="label"
                options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))}
              />
            </Form.Item>
            <Form.Item name="type" label="资产类型">
              <Select options={['服务器','网络设备','安全设备','工控设备','应用系统','数据库','其他'].map(v=>({value:v,label:v}))} />
            </Form.Item>
            <Form.Item name="risk" label="风险等级" rules={[{ required: true, message: '请选择风险等级' }]}>
              <Select options={['严重','高危','中危','低危'].map(v=>({value:v,label:v}))} />
            </Form.Item>
            <Form.Item name="mac" label="MAC 地址">
              <Input placeholder="未拉取到可人工补充" />
            </Form.Item>
            <Form.Item name="os" label="操作系统">
              <Input placeholder="如：Linux / Windows Server" />
            </Form.Item>
            <Form.Item name="isp" label="运营商">
              <Input placeholder="如：中国电信" />
            </Form.Item>
          </div>
          <Form.Item name="ports" label="开放端口">
            <Input placeholder="多个端口用英文逗号分隔，如：80,443,8080" />
          </Form.Item>
          <Form.Item name="services" label="服务">
            <Input.TextArea rows={2} placeholder="多个服务用英文逗号分隔，如：http,https,ssh" />
          </Form.Item>
          <Form.Item name="location" label="位置">
            <Input placeholder="如：安徽 / 合肥 / 蜀山区" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="按条件拉取资产"
        open={queryModalOpen}
        onCancel={() => { setQueryModalOpen(false); setPreviewQuery(''); queryForm.resetFields(); }}
        footer={[
          <Button key="cancel" onClick={() => { setQueryModalOpen(false); setPreviewQuery(''); queryForm.resetFields(); }}>取消</Button>,
          <Button key="save-template" icon={<SaveOutlined />} onClick={() => queryForm.validateFields().then(() => setSaveTemplateOpen(true))}>保存模板</Button>,
          <Button key="preview" loading={previewMutation.isPending} onClick={() => queryForm.validateFields().then(values => previewMutation.mutate(values))}>预览查询</Button>,
          <Button key="submit" type="primary" loading={triggerQueryMutation.isPending} onClick={() => queryForm.validateFields().then(values => triggerQueryMutation.mutate(values))}>提交拉取</Button>,
        ]}
        width={840}
      >
        <Form form={queryForm} layout="vertical" initialValues={{ protocol: '', category: '', support_type: '', status: '' }}>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            归属单位可不选；未能自动匹配单位的资产会进入未归属资产池，可在资产管理中人工修正。
          </Typography.Paragraph>
          <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            <Select
              placeholder="选择常用同步条件"
              value={selectedTemplateId || undefined}
              onChange={value => setSelectedTemplateId(value || '')}
              style={{ width: 260 }}
              allowClear
              showSearch
              optionFilterProp="label"
              options={(queryTemplates || []).map(template => ({ value: template.id, label: template.name }))}
            />
            <Button icon={<FolderOpenOutlined />} onClick={loadQueryTemplate}>载入模板</Button>
          </Space>
          <Typography.Text strong>资产范围</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px', marginTop: 10 }}>
            <Form.Item name="unit_id" label="限定单位（可选）">
              <Select
                placeholder="不限定单位"
                showSearch
                allowClear
                optionFilterProp="label"
                options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))}
              />
            </Form.Item>
            <Form.Item name="time_range" label="发现时间范围" style={{ gridColumn: 'span 2' }}>
              <DatePicker.RangePicker
                showTime
                format="YYYY-MM-DD HH:mm:ss"
                placeholder={['开始时间', '结束时间']}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item name="dept" label="资产单位">
              <Input placeholder="RaySpace dept" />
            </Form.Item>
            <Form.Item name="ip_company_full" label="单位全称">
              <Input placeholder="RaySpace ip_company_full" />
            </Form.Item>
            <Form.Item name="industry" label="行业">
              <Input placeholder="如：教育 / 金融" />
            </Form.Item>
          </div>

          <Typography.Text strong>定位与网络</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px', marginTop: 10 }}>
            <Form.Item name="country" label="国家">
              <Input placeholder="如：中国" />
            </Form.Item>
            <Form.Item name="province" label="省份">
              <Input placeholder="如：安徽" />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input placeholder="如：合肥" />
            </Form.Item>
            <Form.Item name="county" label="区县">
              <Input placeholder="如：蜀山区" />
            </Form.Item>
            <Form.Item name="asn" label="ASN">
              <Input placeholder="如：AS4808" />
            </Form.Item>
            <Form.Item name="isp" label="运营商">
              <Input placeholder="如：电信" />
            </Form.Item>
            <Form.Item name="domain" label="域名">
              <Input placeholder="多个用逗号分隔" />
            </Form.Item>
            <Form.Item name="ports" label="端口">
              <Input placeholder="如：80,443,8080" />
            </Form.Item>
            <Form.Item name="service" label="服务">
              <Input placeholder="如：http / https / ssh" />
            </Form.Item>
            <Form.Item name="protocol" label="协议">
              <Select allowClear options={[{ value: 'tcp', label: 'tcp' }, { value: 'udp', label: 'udp' }]} />
            </Form.Item>
            <Form.Item name="support_type" label="服务类型">
              <Select
                allowClear
                showSearch
                options={['中间件', '数据库', 'Web 容器', '编程语言', '框架', '应用服务'].map(value => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item name="status" label="端口状态">
              <Select allowClear options={[{ value: 'open', label: 'open' }, { value: 'closed', label: 'closed' }]} />
            </Form.Item>
          </div>

          <Typography.Text strong>分类与指纹</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px', marginTop: 10 }}>
            <Form.Item name="support_category" label="服务类别">
              <Input placeholder="如：Web 容器" />
            </Form.Item>
            <Form.Item name="support_service" label="支撑服务名称">
              <Input placeholder="如：Nginx" />
            </Form.Item>
            <Form.Item name="middleware" label="中间件">
              <Input placeholder="如：Tomcat" />
            </Form.Item>
            <Form.Item name="product" label="组件/产品">
              <Input placeholder="如：Nginx / Apache" />
            </Form.Item>
            <Form.Item name="category" label="一级分类">
              <Select allowClear options={['设备类', '操作系统', '支撑服务', '应用系统'].map(value => ({ value, label: value }))} />
            </Form.Item>
            <Form.Item name="category_main" label="二级分类">
              <Input placeholder="如：网站系统" />
            </Form.Item>
            <Form.Item name="category_sub" label="三级分类">
              <Input placeholder="如：Nginx" />
            </Form.Item>
            <Form.Item name="device_type" label="设备类型">
              <Input placeholder="如：物联网设备" />
            </Form.Item>
            <Form.Item name="device_category" label="设备类别">
              <Input placeholder="如：摄像头" />
            </Form.Item>
            <Form.Item name="os_type" label="操作系统类型">
              <Input placeholder="如：Linux" />
            </Form.Item>
            <Form.Item name="os" label="操作系统">
              <Input placeholder="如：debian" />
            </Form.Item>
          </div>

          <Typography.Text strong>Web 与漏洞</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px', marginTop: 10 }}>
            <Form.Item name="title" label="标题">
              <Input placeholder="网站标题" />
            </Form.Item>
            <Form.Item name="server" label="Web 容器">
              <Input placeholder="如：nginx" />
            </Form.Item>
            <Form.Item name="http_status" label="HTTP 状态">
              <Input placeholder="如：200" />
            </Form.Item>
            <Form.Item name="banner" label="Banner">
              <Input placeholder="服务 Banner" />
            </Form.Item>
            <Form.Item name="header" label="Header">
              <Input placeholder="HTTP 响应头" />
            </Form.Item>
            <Form.Item name="body" label="Body">
              <Input placeholder="网页内容" />
            </Form.Item>
            <Form.Item name="cve" label="CVE">
              <Input placeholder="多个用逗号分隔" />
            </Form.Item>
            <Form.Item name="cve_name" label="CVE 名称">
              <Input placeholder="漏洞名称" />
            </Form.Item>
            <Form.Item name="poc" label="PoC">
              <Input placeholder="多个用逗号分隔" />
            </Form.Item>
            <Form.Item name="tag" label="系统标签">
              <Input placeholder="多个用逗号分隔" />
            </Form.Item>
            <Form.Item name="custom_tag" label="自定义标签">
              <Input placeholder="多个用逗号分隔" />
            </Form.Item>
          </div>

          <Form.Item name="ip" label="IP / IP 段">
            <Input.TextArea rows={2} placeholder="多个用逗号或换行分隔，如：36.7.79.25 或 10.10.0.0/16" />
          </Form.Item>
          <Form.Item name="keyword" label="全文关键词">
            <Input placeholder="从 body/banner/title/detail_text 中检索" />
          </Form.Item>
          <Form.Item name="advanced_query" label="高级 RaySpace 语句">
            <Input.TextArea rows={2} placeholder={'如：port:"80" && (os:"linux" || os:"windows")'} />
          </Form.Item>
          {previewQuery && (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              <Typography.Text type="secondary">RaySpace 查询语句：</Typography.Text>
              <pre style={{ marginTop: 8, padding: 12, background: '#f6f8fa', borderRadius: 8, whiteSpace: 'pre-wrap' }}>{previewQuery}</pre>
            </Typography.Paragraph>
          )}
        </Form>
      </Modal>

      <Modal
        title="保存同步条件模板"
        open={saveTemplateOpen}
        onOk={submitQueryTemplate}
        onCancel={() => { setSaveTemplateOpen(false); saveTemplateForm.resetFields(); }}
        confirmLoading={saveTemplateMutation.isPending}
        okText="保存"
        cancelText="取消"
      >
        <Form form={saveTemplateForm} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
            <Input placeholder="如：合肥 HTTPS 资产" />
          </Form.Item>
          <Form.Item name="desc" label="说明">
            <Input.TextArea rows={3} placeholder="记录适用场景、城市、端口、服务类型等" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

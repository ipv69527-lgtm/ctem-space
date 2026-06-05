import { Typography, Table, Spin, Tag, Input, Select, Space, Button, Popover, Checkbox, Tooltip, Modal, Form, message } from 'antd';
import { DesktopOutlined, EditOutlined, ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import apiClient from '@/api/client';
import type { Asset, Unit } from '@/types';
import { useAuthStore } from '@/stores/authStore';

const ASSET_VISIBLE_COLUMNS_KEY = 'ctem.asset.visibleColumns';
const DEFAULT_VISIBLE_COLUMNS = ['name', 'ip', 'unit_name', 'type', 'ports', 'risk', 'location', 'last_seen'];

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

export default function Assets() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const [q, setQ] = useState('');
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState('');
  const [risk, setRisk] = useState('');
  const [port, setPort] = useState('');
  const [service, setService] = useState('');
  const [location, setLocation] = useState('');
  const [hasVulns, setHasVulns] = useState('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(loadVisibleColumns);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [form] = Form.useForm();
  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'operator';

  const { data: assets, isLoading, refetch } = useQuery<Asset[]>({
    queryKey: ['assets', q, unitId, type, risk, port, service, location, hasVulns],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (unitId) params.set('unit_id', unitId);
      if (type) params.set('type', type);
      if (risk) params.set('risk', risk);
      if (port) params.set('port', port);
      if (service) params.set('service', service);
      if (location) params.set('location', location);
      if (hasVulns) params.set('has_vulns', hasVulns);
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

  const unitNameById = new Map((units || []).map(unit => [unit.id, unit.name]));
  const hasFilters = Boolean(q || unitId || type || risk || port || service || location || hasVulns);

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

  const resetFilters = () => {
    setQ('');
    setUnitId('');
    setType('');
    setRisk('');
    setPort('');
    setService('');
    setLocation('');
    setHasVulns('');
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

  const allColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (v: string, r: Asset) => <a onClick={() => navigate(`/assets/${r.id}`)}>{v}</a> },
    { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v: string) => <code>{v}</code> },
    { title: '单位名称', dataIndex: 'unit_id', key: 'unit_name', render: (v: string) => unitNameById.get(v) || '-' },
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
    { title: '国家', key: 'country', render: (_: unknown, r: Asset) => rawValue(r, ['country']) || '-' },
    { title: '省份', key: 'province', render: (_: unknown, r: Asset) => rawValue(r, ['province']) || '-' },
    { title: '城市', key: 'city', render: (_: unknown, r: Asset) => rawValue(r, ['city']) || '-' },
    { title: '经度', key: 'longitude', render: (_: unknown, r: Asset) => rawValue(r, ['longitude', 'lng']) || '-' },
    { title: '纬度', key: 'latitude', render: (_: unknown, r: Asset) => rawValue(r, ['latitude', 'lat']) || '-' },
    { title: '厂商', key: 'manufacturer', ellipsis: true, render: (_: unknown, r: Asset) => appInfoValue(r, ['manufacturer', 'manufacturer_short']) || rawValue(r, ['manufacturer']) || '-' },
    { title: '品牌', key: 'brand', render: (_: unknown, r: Asset) => appInfoValue(r, ['brand']) || rawValue(r, ['brand']) || '-' },
    { title: '型号', key: 'model', render: (_: unknown, r: Asset) => appInfoValue(r, ['model']) || rawValue(r, ['model']) || '-' },
    { title: '应用/产品', key: 'product', ellipsis: true, render: (_: unknown, r: Asset) => appInfoValue(r, ['name']) || rawValue(r, ['product', 'app']) || '-' },
    { title: '设备', key: 'device', ellipsis: true, render: (_: unknown, r: Asset) => rawValue(r, ['device']) || '-' },
    { title: '设备类型', key: 'device_type', render: (_: unknown, r: Asset) => rawValue(r, ['device_type']) || '-' },
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
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined />} placeholder="IP/名称/端口/服务..." value={q} onChange={e => setQ(e.target.value)}
          style={{ width: 240, borderRadius: 10 }} allowClear />
        <Select placeholder="单位名称" value={unitId || undefined} onChange={value => setUnitId(value || '')} style={{ width: 180 }} allowClear
          options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))} showSearch optionFilterProp="label" />
        <Select placeholder="类型" value={type || undefined} onChange={value => setType(value || '')} style={{ width: 130 }} allowClear
          options={['服务器','网络设备','安全设备','工控设备'].map(v=>({value:v,label:v}))} />
        <Select placeholder="风险等级" value={risk || undefined} onChange={value => setRisk(value || '')} style={{ width: 130 }} allowClear
          options={['严重','高危','中危','低危'].map(v=>({value:v,label:v}))} />
        <Input placeholder="端口" value={port} onChange={e => setPort(e.target.value)} style={{ width: 110, borderRadius: 10 }} allowClear />
        <Input placeholder="服务" value={service} onChange={e => setService(e.target.value)} style={{ width: 130, borderRadius: 10 }} allowClear />
        <Input placeholder="位置" value={location} onChange={e => setLocation(e.target.value)} style={{ width: 130, borderRadius: 10 }} allowClear />
        <Select placeholder="漏洞" value={hasVulns || undefined} onChange={value => setHasVulns(value || '')} style={{ width: 130 }} allowClear
          options={[{ value: 'yes', label: '有关联漏洞' }, { value: 'no', label: '无关联漏洞' }]} />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>刷新</Button>
        <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
        <Popover content={columnConfig} trigger="click" placement="bottomRight">
          <Tooltip title="列配置">
            <Button icon={<SettingOutlined />} />
          </Tooltip>
        </Popover>
      </Space>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={assets || []} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          scroll={{ x: 1180 }}
          locale={{ emptyText: hasFilters ? '未找到匹配的资产' : '暂无资产数据，请先同步 Space 数据' }} />
      )}

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
            <Form.Item name="unit_id" label="所属单位" rules={[{ required: true, message: '请选择所属单位' }]}>
              <Select
                placeholder="选择单位"
                showSearch
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
    </>
  );
}

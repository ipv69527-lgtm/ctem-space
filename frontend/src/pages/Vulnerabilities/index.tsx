import { useEffect, useState } from 'react';
import { Typography, Table, Spin, Tag, Input, Select, Space, Button, Modal, Form, message } from 'antd';
import { SafetyOutlined, SearchOutlined, ExpandAltOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import apiClient from '@/api/client';
import type { Vulnerability, Asset, Unit } from '@/types';

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
const severityColors: Record<string, string> = { 严重: 'red', 高危: 'orange', 中危: 'blue', 低危: 'green' };
const pocStatusLabels: Record<string, string> = { none: '无 PoC', available: 'PoC 存在', verified: '已验证命中' };
const pocStatusColors: Record<string, string> = { none: 'default', available: 'orange', verified: 'red' };

export default function Vulnerabilities() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [pocStatus, setPocStatus] = useState('');
  const [unitId, setUnitId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [ip, setIp] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingVuln, setEditingVuln] = useState<Vulnerability | null>(null);

  useEffect(() => {
    const nextQ = searchParams.get('q') || '';
    setQ(nextQ);
  }, [searchParams]);

  const { data: vulns, isLoading } = useQuery<Vulnerability[]>({
    queryKey: ['vulns', q, severity, status, pocStatus, unitId, assetId, ip],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (severity) params.set('severity', severity);
      if (status) params.set('status', status);
      if (pocStatus) params.set('poc_status', pocStatus);
      if (unitId) params.set('unit_id', unitId);
      if (assetId) params.set('asset_id', assetId);
      if (ip) params.set('ip', ip);
      const { data } = await apiClient.get('/vulnerabilities/?' + params.toString());
      return data;
    },
  });

  const { data: assets } = useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data } = await apiClient.get('/assets/');
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

  // Fetch affected assets for expanded row
  const { data: expandedAssets } = useQuery({
    queryKey: ['vuln-assets', expandedId],
    queryFn: async () => {
      if (!expandedId) return [];
      const { data } = await apiClient.get(`/vulnerabilities/${expandedId}/assets`);
      return data.assets || [];
    },
    enabled: !!expandedId,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { status: string; status_note: string } }) =>
      apiClient.patch(`/vulnerabilities/${id}/status`, values),
    onSuccess: () => {
      message.success('漏洞状态已更新');
      setEditingVuln(null);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['vulns'] });
      queryClient.invalidateQueries({ queryKey: ['asset-vulns'] });
      queryClient.invalidateQueries({ queryKey: ['vuln-assets'] });
    },
  });

  const assetsById = new Map((assets || []).map(asset => [asset.id, asset]));
  const unitNameById = new Map((units || []).map(unit => [unit.id, unit.name]));
  const hasFilters = Boolean(q || severity || status || pocStatus || unitId || assetId || ip);

  const resetFilters = () => {
    setQ('');
    setSeverity('');
    setStatus('');
    setPocStatus('');
    setUnitId('');
    setAssetId('');
    setIp('');
  };

  const openStatusModal = (vuln: Vulnerability) => {
    setEditingVuln(vuln);
    form.setFieldsValue({ status: vuln.status, status_note: vuln.status_note || '' });
  };

  const submitStatus = async () => {
    if (!editingVuln) return;
    const values = await form.validateFields();
    statusMutation.mutate({ id: editingVuln.id, values });
  };

  const columns = [
    { title: '漏洞名称', dataIndex: 'title', key: 'title', width: 300, render: (v: string) => <strong>{v}</strong> },
    { title: 'CVE', dataIndex: 'cve', key: 'cve', width: 160, render: (v: string) => <code>{v}</code> },
    {
      title: 'PoC',
      dataIndex: 'poc_status',
      key: 'poc',
      width: 170,
      render: (value: string, record: Vulnerability) => (
        <Space size={4} wrap>
          <Tag color={pocStatusColors[value] || 'default'}>{pocStatusLabels[value] || value || '无 PoC'}</Tag>
          {record.poc && <Typography.Text ellipsis={{ tooltip: record.poc }} style={{ maxWidth: 72 }}>{record.poc}</Typography.Text>}
        </Space>
      ),
    },
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
    { title: '等级', dataIndex: 'severity', key: 'severity', width: 80, render: (v: string) => <Tag color={severityColors[v] || 'default'}>{v}</Tag> },
    {
      title: '单位',
      key: 'units',
      width: 180,
      render: (_: unknown, r: Vulnerability) => {
        const names = Array.from(new Set((r.asset_ids || []).map(id => unitNameById.get(assetsById.get(id)?.unit_id || '')).filter(Boolean)));
        return names.length ? names.map(name => <Tag key={name} color="blue">{name}</Tag>) : '-';
      },
    },
    { title: '影响资产', dataIndex: 'asset_ids', key: 'assets', width: 100, render: (v: string[]) => <span style={{ color: '#1677ff', fontWeight: 600 }}>{v?.length || 0} 个</span> },
    { title: '首次发现', dataIndex: 'first_found', key: 'first_found', width: 120, render: (v: string|null) => v ? new Date(v).toLocaleDateString('zh-CN') : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => <Tag color={statusColors[v] || 'default'}>{v}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, r: Vulnerability) => <Button size="small" onClick={() => openStatusModal(r)}>处置</Button>,
    },
  ];

  return (
    <>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>
        <SafetyOutlined style={{ color: '#f5222d', marginRight: 8 }} /> 漏洞管理
      </Typography.Title>
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined />} placeholder="搜索 CVE/标题..." value={q}
          onChange={e => setQ(e.target.value)} style={{ width: 260, borderRadius: 10 }} allowClear />
        <Select placeholder="单位名称" value={unitId || undefined} onChange={value => setUnitId(value || '')} style={{ width: 180 }} allowClear
          options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))} showSearch optionFilterProp="label" />
        <Select placeholder="资产" value={assetId || undefined} onChange={value => setAssetId(value || '')} style={{ width: 180 }} allowClear
          options={(assets || []).map(asset => ({ value: asset.id, label: `${asset.ip} ${asset.name}` }))} showSearch optionFilterProp="label" />
        <Input placeholder="资产 IP" value={ip} onChange={e => setIp(e.target.value)} style={{ width: 140, borderRadius: 10 }} allowClear />
        <Select placeholder="严重等级" value={severity || undefined} onChange={value => setSeverity(value || '')} style={{ width: 120 }} allowClear
          options={['严重','高危','中危','低危'].map(v=>({value:v,label:v}))} />
        <Select placeholder="处置状态" value={status || undefined} onChange={value => setStatus(value || '')} style={{ width: 130 }} allowClear
          options={VULN_STATUSES.map(v=>({value:v,label:v}))} />
        <Select placeholder="PoC 状态" value={pocStatus || undefined} onChange={value => setPocStatus(value || '')} style={{ width: 140 }} allowClear
          options={[
            { value: 'verified', label: '已验证命中' },
            { value: 'available', label: 'PoC 存在' },
            { value: 'none', label: '无 PoC' },
          ]} />
        <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['vulns'] })}>刷新</Button>
        <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
      </Space>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={vulns || []} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          scroll={{ x: 1280 }}
          locale={{ emptyText: hasFilters ? '未找到匹配的漏洞' : '暂无漏洞数据' }}
          expandable={{
            expandedRowRender: (record) => {
              if (expandedId !== record.id) return null;
              return (
                <div style={{ padding: '8px 0' }}>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>描述：{record.desc || '暂无'}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>PoC 状态：{pocStatusLabels[record.poc_status] || record.poc_status || '无 PoC'}{record.poc ? ` / ${record.poc}` : ''}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>验证证据：{record.poc_evidence || '暂无'}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>修复方案：{record.solution || '暂无'}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>处置备注：{record.status_note || '暂无'}</p>
                  <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>受影响资产：</p>
                  <Space wrap>
                    {expandedAssets?.map((a: Asset & { unit_id?: string; unit_name?: string }) => (
                      <Tag key={a.id} color="blue" style={{ cursor: 'pointer' }}
                        onClick={() => window.open(`/assets/${a.id}`, '_self')}>
                        {a.unit_name ? `${a.unit_name} / ` : ''}{a.name} ({a.ip})
                      </Tag>
                    ))}
                    {(!expandedAssets || expandedAssets.length === 0) && <span style={{ color: '#8c8c8c' }}>无关联资产</span>}
                  </Space>
                </div>
              );
            },
            onExpand: (expanded, record) => setExpandedId(expanded ? record.id : null),
            expandIcon: () => <Button type="link" size="small" icon={<ExpandAltOutlined />} />,
          }}
        />
      )}
      <Modal
        title="漏洞处置"
        open={!!editingVuln}
        onOk={submitStatus}
        onCancel={() => setEditingVuln(null)}
        confirmLoading={statusMutation.isPending}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="处置状态" name="status" rules={[{ required: true, message: '请选择处置状态' }]}>
            <Select options={VULN_STATUSES.map(value => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item label="处置备注" name="status_note">
            <Input.TextArea rows={4} placeholder="填写整改进展、误报原因、复测结论或风险接受说明" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

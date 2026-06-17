import { useEffect, useState } from 'react';
import { Typography, Table, Spin, Tag, Input, Select, Space, Button, Modal, Form, message } from 'antd';
import { SafetyOutlined, SearchOutlined, ExpandAltOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '@/api/client';
import type { Vulnerability, Asset, PaginatedResponse, Unit } from '@/types';

type VulnerabilityAsset = Asset & {
  unit_name?: string;
  source_fields?: string[];
  source_summary?: string;
  source_record_count?: number;
  source_time?: string | null;
};

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
const pocStatusLabels: Record<string, string> = { none: 'CVE版本匹配', available: 'PoC 存在', verified: 'POC已验证命中' };
const pocStatusColors: Record<string, string> = { none: 'default', available: 'orange', verified: 'red' };

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function missingVerifiedEvidence(record: Vulnerability) {
  return record.poc_status === 'verified' && !record.poc_evidence;
}

function vulnerabilityDescription(record: Vulnerability) {
  if (record.desc) return record.desc;
  if (record.poc_status === 'verified' && record.poc) return `POC已验证命中：${record.poc}`;
  if (record.poc_status === 'none' && record.cve) return `CVE版本匹配：${record.cve}`;
  return '';
}

export default function Vulnerabilities() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [pocStatus, setPocStatus] = useState(searchParams.get('poc_status') || '');
  const [unitId, setUnitId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [ip, setIp] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingVuln, setEditingVuln] = useState<Vulnerability | null>(null);

  useEffect(() => {
    const nextQ = searchParams.get('q') || '';
    const nextPocStatus = searchParams.get('poc_status') || '';
    const nextUnitId = searchParams.get('unit_id') || '';
    const nextAssetId = searchParams.get('asset_id') || '';
    const nextIp = searchParams.get('ip') || '';
    setQ(nextQ);
    setPocStatus(nextPocStatus);
    setUnitId(nextUnitId);
    setAssetId(nextAssetId);
    setIp(nextIp);
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [q, severity, status, pocStatus, unitId, assetId, ip]);

  const { data: vulnsPage, isLoading } = useQuery<PaginatedResponse<Vulnerability>>({
    queryKey: ['vulns', q, severity, status, pocStatus, unitId, assetId, ip, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
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

  const { data: assetOptionsPage } = useQuery<PaginatedResponse<Asset>>({
    queryKey: ['asset-options'],
    queryFn: async () => {
      const { data } = await apiClient.get('/assets/?page=1&page_size=500&include_raw=false');
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
  const { data: expandedAssets } = useQuery<VulnerabilityAsset[]>({
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

  const vulns = vulnsPage?.items || [];
  const vulnTotal = vulnsPage?.total || 0;
  const assets = assetOptionsPage?.items || [];
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const unitById = new Map((units || []).map(unit => [unit.id, unit]));
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

  const toggleExpanded = (id: string) => {
    setExpandedId(current => current === id ? null : id);
  };

  const impactedUnitsForVuln = (record: Vulnerability) => {
    const byId = new Map<string, Unit>();
    for (const assetId of record.asset_ids || []) {
      const linkedUnitId = assetsById.get(assetId)?.unit_id;
      if (!linkedUnitId) continue;
      const unit = unitById.get(linkedUnitId);
      if (unit) byId.set(unit.id, unit);
    }
    return Array.from(byId.values());
  };

  const columns = [
    { title: '漏洞名称', dataIndex: 'title', key: 'title', width: 300, render: (v: string, r: Vulnerability) => <a onClick={() => toggleExpanded(r.id)}><strong>{v}</strong></a> },
    { title: 'CVE', dataIndex: 'cve', key: 'cve', width: 160, render: (v: string) => <code>{v}</code> },
    {
      title: 'PoC',
      dataIndex: 'poc_status',
      key: 'poc',
      width: 170,
      render: (value: string, record: Vulnerability) => (
        <Space size={4} wrap>
          <Tag color={pocStatusColors[value] || 'default'}>{pocStatusLabels[value] || value || '无 PoC'}</Tag>
          {missingVerifiedEvidence(record) && <Tag color="orange">缺证据</Tag>}
          {record.poc && <Typography.Text ellipsis={{ tooltip: record.poc }} style={{ maxWidth: 72 }}>{record.poc}</Typography.Text>}
        </Space>
      ),
    },
    { title: '验证时间', dataIndex: 'poc_verified_at', key: 'poc_verified_at', width: 160, render: (value: string | null, record: Vulnerability) => record.poc_status === 'verified' ? formatTime(value) : '-' },
    {
      title: '漏洞描述',
      dataIndex: 'desc',
      key: 'desc',
      width: 260,
      render: (_: string, record: Vulnerability) => {
        const text = vulnerabilityDescription(record);
        return (
          <Typography.Text ellipsis={{ tooltip: text || '-' }} style={{ maxWidth: 240 }}>
            {text || '-'}
          </Typography.Text>
        );
      },
    },
    { title: '等级', dataIndex: 'severity', key: 'severity', width: 80, render: (v: string) => <Tag color={severityColors[v] || 'default'}>{v}</Tag> },
    {
      title: '单位',
      key: 'units',
      width: 180,
      render: (_: unknown, r: Vulnerability) => {
        const impactedUnits = impactedUnitsForVuln(r);
        return impactedUnits.length ? impactedUnits.map(unit => (
          <Tag key={unit.id} color="blue" style={{ cursor: 'pointer' }} onClick={() => navigate(`/units/${unit.id}`)}>{unit.name}</Tag>
        )) : '-';
      },
    },
    {
      title: '影响资产',
      dataIndex: 'asset_ids',
      key: 'assets',
      width: 120,
      render: (v: string[], r: Vulnerability) => (
        <Button type="link" size="small" onClick={() => toggleExpanded(r.id)}>
          {v?.length || 0} 个
        </Button>
      ),
    },
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
          options={assets.map(asset => ({ value: asset.id, label: `${asset.ip} ${asset.name}` }))} showSearch optionFilterProp="label" />
        <Input placeholder="资产 IP" value={ip} onChange={e => setIp(e.target.value)} style={{ width: 140, borderRadius: 10 }} allowClear />
        <Select placeholder="严重等级" value={severity || undefined} onChange={value => setSeverity(value || '')} style={{ width: 120 }} allowClear
          options={['严重','高危','中危','低危'].map(v=>({value:v,label:v}))} />
        <Select placeholder="处置状态" value={status || undefined} onChange={value => setStatus(value || '')} style={{ width: 130 }} allowClear
          options={VULN_STATUSES.map(v=>({value:v,label:v}))} />
        <Select placeholder="PoC 状态" value={pocStatus || undefined} onChange={value => setPocStatus(value || '')} style={{ width: 140 }} allowClear
          options={[
            { value: 'verified', label: 'POC已验证命中' },
            { value: 'none', label: 'CVE版本匹配' },
          ]} />
        <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['vulns'] })}>刷新</Button>
        <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
      </Space>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={vulns} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          scroll={{ x: 1280 }}
          pagination={{
            current: page,
            pageSize,
            total: vulnTotal,
            showSizeChanger: true,
            showTotal: total => `共 ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          locale={{ emptyText: hasFilters ? '未找到匹配的漏洞' : '暂无漏洞数据' }}
          expandable={{
            expandedRowRender: (record) => {
              if (expandedId !== record.id) return null;
              return (
                <div style={{ padding: '8px 0' }}>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>描述：{vulnerabilityDescription(record) || '暂无'}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>PoC 状态：{pocStatusLabels[record.poc_status] || record.poc_status || '无 PoC'}{record.poc ? ` / ${record.poc}` : ''}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>原始验证时间：{record.poc_status === 'verified' ? formatTime(record.poc_verified_at) : '-'}</p>
                  <p style={{ marginBottom: 8, color: missingVerifiedEvidence(record) ? '#d46b08' : '#5f6368' }}>
                    验证证据：{record.poc_evidence || (record.poc_status === 'verified' ? '暂无，需补充验证证据' : '暂无')}
                  </p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>修复方案：{record.solution || '暂无'}</p>
                  <p style={{ marginBottom: 8, color: '#5f6368' }}>处置备注：{record.status_note || '暂无'}</p>
                  <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>受影响资产：</p>
                  <Space wrap>
                    {expandedAssets?.map((a) => (
                      <Tag key={a.id} color="blue">
                        {a.unit_id && a.unit_name && (
                          <>
                            <a onClick={() => navigate(`/units/${a.unit_id}`)}>{a.unit_name}</a>
                            {' / '}
                          </>
                        )}
                        <a onClick={() => navigate(`/assets/${a.id}`)}>{a.name} ({a.ip})</a>
                      </Tag>
                    ))}
                    {(!expandedAssets || expandedAssets.length === 0) && <span style={{ color: '#8c8c8c' }}>无关联资产</span>}
                  </Space>
                  <p style={{ fontWeight: 600, margin: '12px 0 4px', fontSize: 12 }}>来源追踪：</p>
                  <Space wrap>
                    {expandedAssets?.map((a) => (
                      <Tag key={`${a.id}-source`} color="geekblue">
                        {a.ip} / {a.source_summary || '关联资产'} / 原始记录 {a.source_record_count || 0} 条 / {a.source_time ? formatTime(a.source_time) : '时间未知'}
                      </Tag>
                    ))}
                    {(!expandedAssets || expandedAssets.length === 0) && <span style={{ color: '#8c8c8c' }}>暂无来源信息</span>}
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

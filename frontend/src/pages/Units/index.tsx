import { useState } from 'react';
import { Typography, Button, Table, Spin, Tag, message, Modal, Form, Input, Select, Space } from 'antd';
import { BankOutlined, EditOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/api/client';
import type { SyncSchedule, Unit } from '@/types';

interface UnitIpRangeSuggestion {
  unit_id: string;
  unit_name: string;
  asset_count: number;
  existing_count: number;
  new_count: number;
  ip_ranges: string[];
}

export default function Units() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [form] = Form.useForm();

  const { data: units, isLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => { const { data } = await apiClient.get('/units/'); return data; },
  });

  const { data: syncSchedule } = useQuery<SyncSchedule>({
    queryKey: ['sync-schedule'],
    queryFn: async () => { const { data } = await apiClient.get('/sync/schedule'); return data; },
  });

  const syncMutation = useMutation({
    mutationFn: (unitId: string) => apiClient.post(`/sync/trigger/${unitId}`),
    onSuccess: (res: any) => {
      message.success(res.data?.message || '同步完成');
      queryClient.invalidateQueries({ queryKey: ['units'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['vulns'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    },
    onError: () => message.error('同步失败'),
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => editingUnit ? apiClient.put(`/units/${editingUnit.id}`, body) : apiClient.post('/units/', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      setModalOpen(false);
      setEditingUnit(null);
      form.resetFields();
      message.success(editingUnit ? '单位更新成功' : '单位创建成功');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || (editingUnit ? '更新失败' : '创建失败')),
  });

  const ipRangeSuggestionMutation = useMutation({
    mutationFn: async (unitId: string) => {
      const { data } = await apiClient.get<UnitIpRangeSuggestion>(`/units/${unitId}/ip-ranges/suggestions`);
      return data;
    },
    onSuccess: (data) => {
      if (!data.ip_ranges.length) {
        message.warning('该单位当前没有可用于补全的已归属资产 IP');
        return;
      }
      const current = String(form.getFieldValue('ip_ranges') || '')
        .split(/[\n,，\s]+/)
        .map(item => item.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...current, ...data.ip_ranges]));
      form.setFieldValue('ip_ranges', merged.join('\n'));
      message.success(`已补全 ${data.new_count} 个新 IP，保存后生效`);
    },
    onError: (err: any) => message.error(err.response?.data?.detail || 'IP 范围补全失败'),
  });

  const openCreateModal = () => {
    setEditingUnit(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setModalOpen(true);
  };

  const openEditModal = (unit: Unit) => {
    setEditingUnit(unit);
    form.setFieldsValue({
      name: unit.name,
      code: unit.code,
      desc: unit.desc,
      contact: unit.contact,
      email: unit.email,
      status: unit.status,
      ip_ranges: (unit.ip_ranges || []).join('\n'),
      aliases: (unit.aliases || []).join('\n'),
      keywords: (unit.keywords || []).join('\n'),
      region: unit.region,
      region_name: unit.region_name,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUnit(null);
    form.resetFields();
  };

  const normalizeUnitPayload = (values: any) => ({
    ...values,
    ip_ranges: String(values.ip_ranges || '')
      .split(/[\n,，\s]+/)
      .map(item => item.trim())
      .filter(Boolean),
    aliases: String(values.aliases || '')
      .split(/[\n,，]+/)
      .map(item => item.trim())
      .filter(Boolean),
    keywords: String(values.keywords || '')
      .split(/[\n,，]+/)
      .map(item => item.trim())
      .filter(Boolean),
  });

  const columns = [
    { title: '单位名称', dataIndex: 'name', render: (v: string, r: Unit) => <a onClick={() => navigate(`/units/${r.id}`)}>{v}</a> },
    { title: '编码', dataIndex: 'code' },
    { title: 'IP 范围', dataIndex: 'ip_ranges', render: (v: string[]) => v?.map((ip: string) => <Tag key={ip} color="blue">{ip}</Tag>) },
    { title: '联系人', dataIndex: 'contact' },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '活跃' : '停用'}</Tag> },
    { title: '最近同步', dataIndex: 'last_sync', render: (v: string|null) => v
      ? <span style={{ color: '#34C759' }}>🟢 {new Date(v).toLocaleString('zh-CN')}</span>
      : <span style={{ color: '#faad14' }}>🟡 未同步</span> },
    {
      title: '自动同步',
      key: 'sync_policy',
      width: 180,
      render: (_: unknown, r: Unit) => {
        const item = syncSchedule?.units.find(unit => unit.unit_id === r.id);
        if (!syncSchedule?.sync_enabled) return <Tag>手动</Tag>;
        if (item?.active_task_status) return <Tag color="blue">{item.active_task_status === 'running' ? '同步中' : '等待中'}</Tag>;
        if (item?.due) return <Tag color="orange">到期</Tag>;
        return <span>{item?.next_sync ? new Date(item.next_sync).toLocaleString('zh-CN') : '待首次同步'}</span>;
      },
    },
    { title: '操作', width: 150, render: (_: any, r: Unit) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>编辑</Button>
        <Button type="primary" size="small" icon={<SyncOutlined />} loading={syncMutation.isPending && syncMutation.variables === r.id}
          onClick={() => syncMutation.mutate(r.id)}>同步</Button>
      </Space>
    )},
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}><BankOutlined style={{ color: '#2f54eb', marginRight: 8 }} /> 单位管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建单位</Button>
      </div>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={units || []} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          locale={{ emptyText: '暂无单位数据' }} />
      )}

      <Modal title={editingUnit ? '编辑单位' : '新建单位'} open={modalOpen} onCancel={closeModal} onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(normalizeUnitPayload(v))} initialValues={{ status: 'active' }}>
          <Form.Item name="name" label="单位名称" rules={[{ required: true }]}><Input placeholder="如：某省政务云平台" /></Form.Item>
          <Form.Item name="code" label="单位编码" rules={[{ required: true }]}><Input placeholder="如：XX-YWY" /></Form.Item>
          <Form.Item name="desc" label="描述"><Input placeholder="单位描述" /></Form.Item>
          <Form.Item name="contact" label="联系人"><Input placeholder="联系人姓名" /></Form.Item>
          <Form.Item name="email" label="联系邮箱"><Input placeholder="email@example.com" /></Form.Item>
          <Form.Item name="status" label="状态"><Select options={[{ value: 'active', label: '活跃' }, { value: 'inactive', label: '停用' }]} /></Form.Item>
          <Form.Item
            name="ip_ranges"
            label={(
              <Space size={8}>
                <span>IP 范围（每行一个）</span>
                {editingUnit && (
                  <Button
                    size="small"
                    htmlType="button"
                    loading={ipRangeSuggestionMutation.isPending}
                    onClick={() => ipRangeSuggestionMutation.mutate(editingUnit.id)}
                  >
                    根据资产补全
                  </Button>
                )}
              </Space>
            )}
          >
            <Input.TextArea rows={3} placeholder="如：10.10.0.0/16&#10;36.7.79.25" />
          </Form.Item>
          <Form.Item name="aliases" label="单位别名（每行一个）">
            <Input.TextArea rows={3} placeholder="用于自动归属精确匹配，如简称、历史名称" />
          </Form.Item>
          <Form.Item name="keywords" label="归属关键词（每行一个）">
            <Input.TextArea rows={3} placeholder="用于 RaySpace 单位、标题、域名等字段包含匹配" />
          </Form.Item>
          <Form.Item name="region" label="区域编码"><Input placeholder="如：340100" /></Form.Item>
          <Form.Item name="region_name" label="行政区域"><Input placeholder="如：安徽省" /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

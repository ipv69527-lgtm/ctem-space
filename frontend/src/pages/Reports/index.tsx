import { useState } from 'react';
import { Typography, Table, Button, Tag, Modal, Form, Input, Select, message, Spin, Space } from 'antd';
import { DeleteOutlined, DownloadOutlined, FileExcelOutlined, FileTextOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { Report, Template, Unit } from '@/types';

const VULN_STATUSES = ['待确认', '待整改', '整改中', '待复测', '已修复', '误报', '接受风险'];

export default function Reports() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: ['reports'],
    queryFn: async () => { const { data } = await apiClient.get('/reports/'); return data; },
  });

  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => { const { data } = await apiClient.get('/units/'); return data; },
  });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => { const { data } = await apiClient.get('/templates/'); return data; },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiClient.post('/reports/', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reports'] }); setModalOpen(false); form.resetFields(); message.success('报表已生成'); },
  });

  const availableTemplates = templates || [];
  const selectedTemplateId = Form.useWatch('template_id', form);
  const selectedTemplate = availableTemplates.find(item => item.id === selectedTemplateId);

  const openCreateModal = () => {
    const first = availableTemplates[0];
    if (!first) {
      message.warning('请先创建或初始化报表模板');
      return;
    }
    form.setFieldsValue({
      title: `${first.name}-${new Date().toLocaleDateString('zh-CN')}`,
      type: first.name,
      template_id: first.id,
      format: first.type,
      severity_filter: [],
      status_filter: [],
    });
    setModalOpen(true);
  };

  const handleTemplateChange = (value: string) => {
    const item = availableTemplates.find(option => option.id === value);
    if (!item) return;
    form.setFieldsValue({
      type: item.name,
      format: item.type,
      title: `${item.name}-${new Date().toLocaleDateString('zh-CN')}`,
    });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/reports/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reports'] }); message.success('已删除'); },
  });

  const downloadReport = async (report: Report) => {
    try {
      const res = await apiClient.get(`/reports/${report.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title}.${report.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      message.error(err.response?.data?.detail || '下载失败');
    }
  };

  const formatIcon = (format: string) => {
    if (format === 'xlsx') return <FileExcelOutlined style={{ color: '#237804', marginRight: 6 }} />;
    if (format === 'html') return <GlobalOutlined style={{ color: '#1677ff', marginRight: 6 }} />;
    return <FileTextOutlined style={{ color: '#fa8c16', marginRight: 6 }} />;
  };

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', render: (v: string) => <strong>{v}</strong> },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '模板', dataIndex: 'template_name', key: 'template_name', render: (v: string | null) => v || '-' },
    { title: '范围', dataIndex: 'unit_name', key: 'unit_name', render: (v: string | null) => v || '全量单位' },
    { title: '格式', dataIndex: 'format', key: 'format', render: (v: string) => <span>{formatIcon(v)}.{v}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => {
      const m: Record<string, {color: string; text: string}> = { completed: {color:'green',text:'已完成'}, processing: {color:'orange',text:'生成中'}, failed: {color:'red',text:'失败'} };
      return <Tag color={m[v]?.color}>{m[v]?.text || v}</Tag>;
    }},
    { title: '生成时间', dataIndex: 'created_at', key: 'created_at', render: (v: string|null) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    { title: '操作', key: 'actions', render: (_: any, r: Report) => (
      <Space>
        {r.status === 'completed' && <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadReport(r)}>下载</Button>}
        <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => deleteMutation.mutate(r.id)}>删除</Button>
      </Space>
    )},
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}><FileTextOutlined style={{ color: '#fa8c16', marginRight: 8 }} /> 报表管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal} disabled={!availableTemplates.length}>生成报表</Button>
      </div>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={reports || []} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          locale={{ emptyText: '暂无报表，点击"生成报表"创建' }} />
      )}

      <Modal title="生成商用报表" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMutation.mutate(v)}
          initialValues={{ format: 'xlsx', type: '资产清单报告', severity_filter: [], status_filter: [] }}
        >
          <Form.Item name="title" label="报表标题" rules={[{ required: true }]}><Input placeholder="如：2026年6月安全态势报告" /></Form.Item>
          <Form.Item name="template_id" label="商用模板" rules={[{ required: true, message: '请选择报表模板' }]}>
            <Select
              options={availableTemplates.map(item => ({
                value: item.id,
                label: `${item.name} · .${item.type}`,
              }))}
              onChange={handleTemplateChange}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="type" hidden><Input /></Form.Item>
          {selectedTemplate && <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>{selectedTemplate.desc}</Typography.Paragraph>}
          <Form.Item name="format" label="输出格式"><Select options={[{value:'docx',label:'Word (.docx)'},{value:'xlsx',label:'Excel (.xlsx)'},{value:'html',label:'HTML (.html)'}]} /></Form.Item>
          <Form.Item name="unit_id" label="目标单位">
            <Select
              placeholder="留空为全量单位"
              allowClear
              showSearch
              optionFilterProp="label"
              options={(units || []).map(unit => ({ value: unit.id, label: unit.name }))}
            />
          </Form.Item>
          <Form.Item name="severity_filter" label="漏洞等级">
            <Select
              mode="multiple"
              placeholder="留空为全部等级"
              options={['严重','高危','中危','低危'].map(value => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item name="status_filter" label="处置状态">
            <Select
              mode="multiple"
              placeholder="留空为全部状态"
              options={VULN_STATUSES.map(value => ({ value, label: value }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

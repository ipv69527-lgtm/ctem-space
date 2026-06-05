import { useState } from 'react';
import { Typography, Button, Table, Tag, Space, message, Modal, Form, Input, Select, Spin, Upload } from 'antd';
import { DownloadOutlined, EditOutlined, PlusOutlined, DeleteOutlined, EyeOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { Template } from '@/types';

const splitVars = (value?: string) => (value || '')
  .split(/[,\n，]/)
  .map((v) => v.trim())
  .filter(Boolean);

export default function Templates() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [previewing, setPreviewing] = useState<Template | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const { data } = await apiClient.get('/templates/');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiClient.post('/templates/', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setModalOpen(false);
      form.resetFields();
      message.success('模板已创建');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '创建失败'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.patch(`/templates/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      message.success('模板已保存');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已删除');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '删除失败'),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const data = new FormData();
      data.append('file', file);
      return apiClient.post(`/templates/${id}/file`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      message.success('Word 模板已上传');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '上传失败'),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/templates/${id}/file`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      message.success('Word 模板文件已移除');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '移除失败'),
  });

  const downloadTemplateFile = async (template: Template) => {
    try {
      const res = await apiClient.get(`/templates/${template.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      message.error(err.response?.data?.detail || '下载失败');
    }
  };

  const openCreateModal = () => {
    setEditing(null);
    form.setFieldsValue({ type: 'docx', vars: '', content: '' });
    setModalOpen(true);
  };

  const openEditModal = (template: Template) => {
    setEditing(template);
    form.setFieldsValue({
      name: template.name,
      desc: template.desc,
      type: template.type,
      vars: (template.vars || []).join('\n'),
      content: template.content || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = (v: any) => {
    const body = { ...v, vars: splitVars(v.vars) };
    if (editing) {
      updateMutation.mutate({ id: editing.id, body });
      return;
    }
    createMutation.mutate(body);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}><EditOutlined style={{ color: '#722ed1', marginRight: 8 }} />报表模板</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建模板</Button>
      </div>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={templates || []} rowKey="id" style={{ background: '#fff', borderRadius: 14 }}
          locale={{ emptyText: '暂无模板，点击"新建模板"创建' }}
          columns={[
            { title: '模板名称', dataIndex: 'name' },
            { title: '描述', dataIndex: 'desc' },
            { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>.{v}</Tag> },
            { title: 'Word模板', dataIndex: 'has_file', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '已上传' : '未上传'}</Tag> },
            { title: '变量', dataIndex: 'vars', render: (v: string[]) => (v || []).map(x => <Tag key={x} color="orange">{`{{${x}}}`}</Tag>) },
            { title: '来源', dataIndex: 'source', render: (v: string) => <Tag color={v === 'system' ? 'blue' : 'default'}>{v === 'system' ? '系统' : '用户'}</Tag> },
            { title: '操作', render: (_: any, r: Template) => (
              <Space>
                <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setPreviewing(r)}>预览</Button>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>编辑</Button>
                <Upload
                  accept=".docx"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    uploadMutation.mutate({ id: r.id, file });
                    return false;
                  }}
                >
                  <Button type="link" size="small" icon={<UploadOutlined />} loading={uploadMutation.isPending}>上传Word</Button>
                </Upload>
                {r.has_file && <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadTemplateFile(r)}>下载Word</Button>}
                {r.has_file && <Button type="link" size="small" danger onClick={() => deleteFileMutation.mutate(r.id)}>移除Word</Button>}
                <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={r.source === 'system'}
                  onClick={() => deleteMutation.mutate(r.id)}>删除</Button>
              </Space>
            ) },
          ]} />
      )}

      <Modal title={editing ? '编辑模板' : '新建模板'} open={modalOpen} onCancel={() => { setModalOpen(false); setEditing(null); }} onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending} width={760}>
        <Form form={form} layout="vertical" initialValues={{ type: 'docx' }}
          onFinish={handleSubmit}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input placeholder="如：季度安全态势模板" /></Form.Item>
          <Form.Item name="desc" label="描述"><Input placeholder="模板用途说明" /></Form.Item>
          <Form.Item name="type" label="模板类型"><Select options={[{value:'docx',label:'Word (.docx)'},{value:'xlsx',label:'Excel (.xlsx)'},{value:'html',label:'HTML (.html)'}]} /></Form.Item>
          <Form.Item name="vars" label="变量">
            <Input.TextArea rows={3} placeholder="每行或逗号分隔，如：unit_name, asset_count, vuln_count" />
          </Form.Item>
          <Form.Item
            name="content"
            label="模板正文"
            tooltip="支持 {{变量名}} 占位符，生成报表时会自动替换。"
          >
            <Input.TextArea
              rows={10}
              placeholder="如：本报告覆盖 {{unit_name}}，资产数量 {{asset_count}} 个，严重/高危漏洞 {{critical_high}} 个。"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={previewing?.name || '模板预览'} open={!!previewing} onCancel={() => setPreviewing(null)} footer={null} width={720}>
        <Typography.Paragraph type="secondary">{previewing?.desc || '暂无描述'}</Typography.Paragraph>
        <Typography.Paragraph>
          <Tag color={previewing?.has_file ? 'green' : 'default'}>{previewing?.has_file ? '已上传 Word 模板' : '未上传 Word 模板'}</Tag>
        </Typography.Paragraph>
        <Typography.Paragraph>
          {(previewing?.vars || []).map(x => <Tag key={x} color="orange">{`{{${x}}}`}</Tag>)}
        </Typography.Paragraph>
        <Input.TextArea value={previewing?.content || '暂无模板正文'} rows={12} readOnly />
      </Modal>
    </>
  );
}

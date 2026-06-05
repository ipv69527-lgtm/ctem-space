import { useState } from 'react';
import { Typography, Table, Button, Tag, Modal, Form, Input, Select, message, Spin, Space } from 'antd';
import { EditOutlined, KeyOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import apiClient from '@/api/client';

interface UserData {
  id: string; username: string; name: string; role: string;
  email: string; status: string; last_login: string | null;
}

export default function Users() {
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserData | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const setCurrentUser = useAuthStore(s => s.setUser);

  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ['users'],
    queryFn: async () => { const { data } = await apiClient.get('/users/'); return data; },
    enabled: currentUser?.role === 'super_admin',
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiClient.post('/users/', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); closeUserModal(); message.success('用户创建成功'); },
    onError: (err: any) => message.error(err.response?.data?.detail || '创建失败'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.put(`/users/${id}`, body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      if (currentUser?.id === res.data.id) setCurrentUser(res.data);
      closeUserModal();
      message.success('用户信息已更新');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '更新失败'),
  });

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => apiClient.put(`/users/${id}/password`, { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      closePasswordModal();
      message.success('密码已修改');
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '修改失败'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => apiClient.put(`/users/${id}/toggle-status`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); message.success('状态已更新'); },
    onError: (err: any) => message.error(err.response?.data?.detail || '状态更新失败'),
  });

  const roleNames: Record<string, string> = { super_admin: '超级管理员', operator: '运营人员', auditor: '审计员' };
  const roleColors: Record<string, string> = { super_admin: 'red', operator: 'blue', auditor: 'default' };
  const passwordRules = [
    { required: true },
    { min: 12, message: '至少 12 位' },
    {
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/,
      message: '需包含大小写字母、数字和特殊字符',
    },
  ];

  const openCreateModal = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'operator' });
    setModalOpen(true);
  };

  const openEditModal = (user: UserData) => {
    setEditingUser(user);
    form.setFieldsValue({ username: user.username, name: user.name, role: user.role, email: user.email });
    setModalOpen(true);
  };

  const closeUserModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    form.resetFields();
  };

  const openPasswordModal = (user: UserData) => {
    setPasswordUser(user);
    passwordForm.resetFields();
    setPasswordOpen(true);
  };

  const closePasswordModal = () => {
    setPasswordOpen(false);
    setPasswordUser(null);
    passwordForm.resetFields();
  };

  const submitUserForm = (values: any) => {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, body: { name: values.name, role: values.role, email: values.email || '' } });
    } else {
      createMutation.mutate(values);
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username', render: (v: string) => <strong>{v}</strong> },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (v: string) => <Tag color={roleColors[v]}>{roleNames[v]||v}</Tag> },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v==='active'?'green':'default'}>{v==='active'?'活跃':'禁用'}</Tag> },
    { title: '最近登录', dataIndex: 'last_login', key: 'last_login', render: (v: string|null) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    { title: '操作', key: 'actions', render: (_: any, r: UserData) => (
      <Space>
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>编辑</Button>
        <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => openPasswordModal(r)}>改密</Button>
        <Button type="link" size="small" disabled={r.id === currentUser?.id}
          onClick={() => toggleMutation.mutate(r.id)}>{r.status==='active'?'禁用':'启用'}</Button>
      </Space>
    )},
  ];

  if (currentUser?.role !== 'super_admin') {
    return <Typography.Text type="secondary">仅超级管理员可访问用户管理</Typography.Text>;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}><TeamOutlined style={{ color: '#52c41a', marginRight: 8 }} /> 用户管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建用户</Button>
      </div>
      {isLoading ? <Spin size="large" style={{ display: 'block', margin: '10vh auto' }} /> : (
        <Table dataSource={users || []} columns={columns} rowKey="id" style={{ background: '#fff', borderRadius: 14 }} />
      )}

      <Modal title={editingUser ? '编辑用户' : '新建用户'} open={modalOpen} onCancel={closeUserModal} onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}>
        <Form form={form} layout="vertical" onFinish={submitUserForm}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input placeholder="登录用户名" disabled={!!editingUser} />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input placeholder="显示名称" /></Form.Item>
          {!editingUser && (
            <Form.Item name="password" label="密码" rules={passwordRules}>
              <Input.Password placeholder="至少12位，含大小写字母、数字和特殊字符" />
            </Form.Item>
          )}
          <Form.Item name="role" label="角色"><Select options={[{value:'super_admin',label:'超级管理员'},{value:'operator',label:'运营人员'},{value:'auditor',label:'审计员'}]} /></Form.Item>
          <Form.Item name="email" label="邮箱"><Input placeholder="email@ctem.local" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`修改密码：${passwordUser?.username || ''}`} open={passwordOpen} onCancel={closePasswordModal}
        onOk={() => passwordForm.submit()} confirmLoading={passwordMutation.isPending}>
        <Form form={passwordForm} layout="vertical"
          onFinish={(v) => passwordUser && passwordMutation.mutate({ id: passwordUser.id, password: v.password })}>
          <Form.Item name="password" label="新密码" rules={passwordRules}>
            <Input.Password placeholder="至少12位，含大小写字母、数字和特殊字符" />
          </Form.Item>
          <Form.Item name="confirm" label="确认密码" dependencies={['password']} rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}>
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

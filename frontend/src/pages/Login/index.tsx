import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import { useMutation } from '@tanstack/react-query';
import apiClient from '@/api/client';

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      apiClient.post('/auth/login', body),
    onSuccess: (res) => {
      const { access_token, user } = res.data;
      login(user, access_token);
      message.success('登录成功！欢迎使用 CTEM 平台');
      navigate('/dashboard');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || '登录失败，请检查用户名和密码';
      message.error(msg);
    },
  });

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #f2f2f7 0%, #e8e8ed 100%)' }}>
      <Card style={{ width: 420, borderRadius: 20, backdropFilter: 'blur(30px)', background: 'rgba(255,255,255,.85)' }}
        styles={{ body: { padding: '48px 40px 36px' } }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <SafetyOutlined style={{ fontSize: 40, color: '#007AFF' }} />
          <Typography.Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>CTEM 平台</Typography.Title>
          <Typography.Text type="secondary">Continuous Threat Exposure Management</Typography.Text>
        </div>
        <Form onFinish={(v) => loginMutation.mutate(v)} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input size="large" placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password size="large" placeholder="请输入密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loginMutation.isPending} block size="large" style={{ borderRadius: 12 }}>
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

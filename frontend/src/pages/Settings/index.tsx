import { useState, useEffect } from 'react';
import { Typography, Card, Form, Input, Button, Select, message, Switch, Tag, Space, Descriptions, Table } from 'antd';
import { SettingOutlined, LinkOutlined, EnvironmentOutlined, HeartOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { DeepHealth, SyncSchedule, SyncScheduleUnit } from '@/types';

const provinceCityMap: Record<string, string[]> = {
  '安徽省': ['合肥市','芜湖市','蚌埠市','安庆市','黄山市'],
  '北京市': ['东城区','西城区','朝阳区','海淀区'],
  '上海市': ['浦东新区','黄浦区','徐汇区'],
  '广东省': ['广州市','深圳市','珠海市','东莞市'],
  '浙江省': ['杭州市','宁波市','温州市'],
  '四川省': ['成都市','绵阳市','宜宾市'],
};

export default function Settings() {
  const [province, setProvince] = useState('安徽省');
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const syncEnabled = Form.useWatch('sync_enabled', form);

  const { data: spaceConfig } = useQuery({
    queryKey: ['space-config'],
    queryFn: async () => { const { data } = await apiClient.get('/sync/config'); return data; },
  });

  const { data: deepHealth, refetch: refetchHealth, isFetching: healthLoading } = useQuery<DeepHealth>({
    queryKey: ['deep-health'],
    queryFn: async () => {
      const { data } = await apiClient.get('/health/deep');
      return data;
    },
  });

  const { data: syncSchedule, refetch: refetchSchedule, isFetching: scheduleLoading } = useQuery<SyncSchedule>({
    queryKey: ['sync-schedule'],
    queryFn: async () => {
      const { data } = await apiClient.get('/sync/schedule');
      return data;
    },
  });

  useEffect(() => {
    if (spaceConfig) {
      form.setFieldsValue(spaceConfig);
    }
  }, [spaceConfig, form]);

  const saveConfig = useMutation({
    mutationFn: (body: any) => apiClient.post('/sync/config', body),
    onSuccess: () => {
      message.success('配置已保存');
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['deep-health'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '保存失败'),
  });

  const testConn = useMutation({
    mutationFn: () => apiClient.post('/sync/test-connection'),
    onSuccess: (res: any) => {
      const msg = res.data?.message || '';
      if (res.data?.ok) message.success(msg);
      else message.warning(msg);
    },
    onError: () => message.error('连接测试失败'),
  });

  const runDue = useMutation({
    mutationFn: () => apiClient.post('/sync/schedule/run-due'),
    onSuccess: (res: any) => {
      message.success(`已提交 ${res.data?.created || 0} 个到期同步任务`);
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '扫描失败'),
  });

  const intervalOptions = [
    { value: 0, label: '手动同步' },
    { value: 60, label: '每小时' },
    { value: 360, label: '每 6 小时' },
    { value: 720, label: '每 12 小时' },
    { value: 1440, label: '每天' },
    { value: 10080, label: '每周' },
  ];

  const taskStatusColors: Record<string, string> = { success: 'green', failed: 'red', running: 'blue', pending: 'orange' };

  return (
    <>
      <Typography.Title level={3}><SettingOutlined style={{ color: '#8c8c8c', marginRight: 8 }} />系统设置</Typography.Title>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card
          title={<><HeartOutlined /> 生产健康检查</>}
          style={{ borderRadius: 14, gridColumn: '1 / -1' }}
          extra={<Button size="small" icon={<ReloadOutlined />} loading={healthLoading} onClick={() => refetchHealth()}>刷新</Button>}
        >
          <Space style={{ marginBottom: 12 }}>
            <Tag color={deepHealth?.status === 'ok' ? 'green' : 'orange'}>{deepHealth?.status === 'ok' ? '正常' : '降级'}</Tag>
            <span>{deepHealth?.app || 'CTEM Platform'}</span>
          </Space>
          <Descriptions column={3} size="small" bordered>
            {Object.entries(deepHealth?.checks || {}).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                <Tag color={value.ok ? 'green' : 'red'}>{value.ok ? '正常' : '异常'}</Tag>
                <span>{value.message}</span>
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
        <Card title={<><LinkOutlined /> Space 连接配置</>} style={{ borderRadius: 14 }}>
          <Form form={form} layout="vertical" onFinish={(v) => saveConfig.mutate(v)}
            initialValues={{
              base_url: '',
              username: '',
              password: '',
              api_key: '',
              auth_type: 'rayspace',
              asset_path: 'api/asset/select/query',
              vulnerability_path: 'api/v1/vulnerabilities',
              verify_tls: false,
              mock_mode: false,
              sync_enabled: false,
              sync_interval_minutes: 0,
            }}>
            <Form.Item name="base_url" label="Space API 地址" rules={[{ required: true }]}>
              <Input placeholder="https://172.18.0.220" />
            </Form.Item>
            <Form.Item name="auth_type" label="认证方式">
              <Select
                options={[
                  { value: 'rayspace', label: 'RaySpace SID' },
                  { value: 'auto', label: '自动' },
                  { value: 'bearer', label: 'Bearer Token' },
                  { value: 'api_key', label: 'X-API-Key' },
                  { value: 'basic', label: 'Basic Auth' },
                  { value: 'none', label: '无认证' },
                ]}
              />
            </Form.Item>
            <Form.Item name="username" label="用户名">
              <Input placeholder="Basic Auth 用户名" />
            </Form.Item>
            <Form.Item name="password" label="密码">
              <Input.Password placeholder="留空则保持已有密码" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key（可选）">
              <Input placeholder="附加 API Key" />
            </Form.Item>
            <Form.Item name="asset_path" label="资产接口路径" rules={[{ required: true }]}>
              <Input placeholder="api/v1/assets" />
            </Form.Item>
            <Form.Item name="vulnerability_path" label="漏洞接口路径" rules={[{ required: true }]}>
              <Input placeholder="api/v1/vulnerabilities" />
            </Form.Item>
            <Form.Item name="verify_tls" label="TLS 证书校验" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="mock_mode" label="Mock 模式" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="sync_enabled" label="自动同步" valuePropName="checked">
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
            <Form.Item name="sync_interval_minutes" label="同步周期" rules={[{
              validator: (_, value) => {
                if (!syncEnabled || Number(value) > 0) return Promise.resolve();
                return Promise.reject(new Error('开启自动同步时必须选择同步周期'));
              },
            }]}>
              <Select options={intervalOptions} disabled={!syncEnabled} />
            </Form.Item>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => testConn.mutate()} loading={testConn.isPending}>测试连接</Button>
              <Button type="primary" htmlType="submit" loading={saveConfig.isPending}>保存配置</Button>
            </div>
          </Form>
        </Card>
        <Card
          title={<><SyncOutlined /> 自动同步策略</>}
          style={{ borderRadius: 14 }}
          extra={
            <Space>
              <Button size="small" icon={<ReloadOutlined />} loading={scheduleLoading} onClick={() => refetchSchedule()}>刷新</Button>
              <Button size="small" type="primary" loading={runDue.isPending} onClick={() => runDue.mutate()}>扫描到期单位</Button>
            </Space>
          }
        >
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color={syncSchedule?.sync_enabled ? 'green' : 'default'}>{syncSchedule?.sync_enabled ? '自动同步已开启' : '手动同步'}</Tag>
            <span>周期：{intervalOptions.find(item => item.value === syncSchedule?.sync_interval_minutes)?.label || `${syncSchedule?.sync_interval_minutes || 0} 分钟`}</span>
          </Space>
          <Table<SyncScheduleUnit>
            size="small"
            rowKey="unit_id"
            dataSource={syncSchedule?.units || []}
            pagination={{ pageSize: 5 }}
            columns={[
              { title: '单位', dataIndex: 'unit_name', ellipsis: true },
              {
                title: '最近同步',
                dataIndex: 'last_sync',
                width: 150,
                render: (v: string | null) => v ? new Date(v).toLocaleString('zh-CN') : '未同步',
              },
              {
                title: '下次同步',
                dataIndex: 'next_sync',
                width: 150,
                render: (v: string | null, r) => r.unit_status !== 'active' ? '单位停用' : (v ? new Date(v).toLocaleString('zh-CN') : '待首次同步'),
              },
              {
                title: '状态',
                key: 'status',
                width: 100,
                render: (_: unknown, r) => {
                  if (r.active_task_status) return <Tag color={taskStatusColors[r.active_task_status] || 'blue'}>{r.active_task_status}</Tag>;
                  if (r.due) return <Tag color="orange">到期</Tag>;
                  return <Tag color={taskStatusColors[r.last_task_status] || 'default'}>{r.last_task_status || '无任务'}</Tag>;
                },
              },
            ]}
            locale={{ emptyText: '暂无单位同步策略数据' }}
          />
        </Card>
        <Card title={<><EnvironmentOutlined /> 区域配置</>} style={{ borderRadius: 14 }}>
          <Form layout="vertical">
            <Form.Item label="默认地图展示地区">
              <Select value={province} onChange={setProvince} options={Object.keys(provinceCityMap).map(p => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item label="下属地市">
              <Select placeholder="选择地市..." options={(provinceCityMap[province] || []).map(c => ({ value: c, label: c }))} />
            </Form.Item>
            <Button type="primary" onClick={() => message.success('区域配置已保存')}>保存配置</Button>
          </Form>
        </Card>
      </div>
    </>
  );
}

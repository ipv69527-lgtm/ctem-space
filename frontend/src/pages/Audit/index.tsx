import { useState } from 'react';
import { Typography, Table, Tag, Input, Select, Space, Button, Collapse } from 'antd';
import { AuditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { AuditLog } from '@/types';

const actionLabels: Record<string, string> = {
  'auth.login': '登录',
  'unit.create': '创建单位',
  'unit.update': '编辑单位',
  'unit.delete': '删除单位',
  'user.create': '创建用户',
  'user.update': '编辑用户',
  'user.password_update': '修改密码',
  'user.toggle_status': '切换用户状态',
  'sync.trigger': '触发同步',
  'sync.retry': '重试同步',
  'sync.test_connection': '测试连接',
  'space_config.update': '保存 Space 配置',
  'vulnerability.create': '创建漏洞',
  'vulnerability.update': '编辑漏洞',
  'vulnerability.status_update': '漏洞状态流转',
  'report.create': '生成报表',
  'report.download': '下载报表',
  'report.delete': '删除报表',
};

const targetLabels: Record<string, string> = {
  user: '用户',
  unit: '单位',
  vulnerability: '漏洞',
  report: '报表',
  sync_task: '同步任务',
  space_config: 'Space 配置',
};

export default function Audit() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [result, setResult] = useState('');
  const [username, setUsername] = useState('');

  const { data: logs, isLoading, refetch } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', q, action, targetType, result, username],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (action) params.set('action', action);
      if (targetType) params.set('target_type', targetType);
      if (result) params.set('result', result);
      if (username) params.set('username', username);
      const { data } = await apiClient.get(`/audit/?${params.toString()}`);
      return data;
    },
  });

  const hasFilters = Boolean(q || action || targetType || result || username);
  const resetFilters = () => {
    setQ('');
    setAction('');
    setTargetType('');
    setResult('');
    setUsername('');
  };

  return (
    <>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>
        <AuditOutlined style={{ color: '#1677ff', marginRight: 8 }} /> 审计日志
      </Typography.Title>
      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <Input prefix={<SearchOutlined />} placeholder="搜索用户/对象/动作..." value={q} onChange={e => setQ(e.target.value)}
          style={{ width: 240, borderRadius: 10 }} allowClear />
        <Input placeholder="用户" value={username} onChange={e => setUsername(e.target.value)}
          style={{ width: 140, borderRadius: 10 }} allowClear />
        <Select placeholder="动作" value={action || undefined} onChange={value => setAction(value || '')} style={{ width: 180 }} allowClear
          options={Object.keys(actionLabels).map(value => ({ value, label: actionLabels[value] }))} showSearch optionFilterProp="label" />
        <Select placeholder="对象类型" value={targetType || undefined} onChange={value => setTargetType(value || '')} style={{ width: 150 }} allowClear
          options={Object.keys(targetLabels).map(value => ({ value, label: targetLabels[value] }))} />
        <Select placeholder="结果" value={result || undefined} onChange={value => setResult(value || '')} style={{ width: 120 }} allowClear
          options={[{ value: 'success', label: '成功' }, { value: 'failed', label: '失败' }]} />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>刷新</Button>
        <Button disabled={!hasFilters} onClick={resetFilters}>重置</Button>
      </Space>
      <Table
        loading={isLoading}
        dataSource={logs || []}
        rowKey="id"
        style={{ background: '#fff', borderRadius: 14 }}
        scroll={{ x: 1180 }}
        expandable={{
          expandedRowRender: (record) => (
            <Collapse
              size="small"
              items={[{
                key: 'detail',
                label: '操作详情',
                children: <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(record.detail || {}, null, 2)}</pre>,
              }]}
            />
          ),
        }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 180, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
          { title: '用户', dataIndex: 'username', width: 140, render: (v: string) => v || '-' },
          { title: '动作', dataIndex: 'action', width: 160, render: (v: string) => actionLabels[v] || v },
          { title: '对象类型', dataIndex: 'target_type', width: 120, render: (v: string) => targetLabels[v] || v || '-' },
          { title: '对象', dataIndex: 'target_name', ellipsis: true, render: (v: string, r: AuditLog) => v || r.target_id || '-' },
          { title: '结果', dataIndex: 'result', width: 90, render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag> },
          { title: '来源 IP', dataIndex: 'ip', width: 140, render: (v: string) => v || '-' },
        ]}
        locale={{ emptyText: hasFilters ? '未找到匹配的审计日志' : '暂无审计日志' }}
      />
    </>
  );
}

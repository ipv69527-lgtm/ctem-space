import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Descriptions, Table, Tag, Spin, Card, Button, Tabs, Space, message, Input, Select } from 'antd';
import { BankOutlined, ArrowLeftOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import apiClient from '@/api/client';
import type { Unit, Asset, Vulnerability, SyncSchedule } from '@/types';

interface SyncTask {
  id: string;
  status: string;
  message: string;
  query_condition: string;
  fetched_assets: number;
  synced_assets: number;
  synced_vulns: number;
  error_detail: string;
  created_at: string;
  updated_at: string;
}

export default function UnitDetail() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [taskStatus, setTaskStatus] = useState('');
  const [taskQ, setTaskQ] = useState('');

  const { data: unit, isLoading } = useQuery<Unit>({
    queryKey: ['unit', unitId],
    queryFn: async () => { const { data } = await apiClient.get(`/units/${unitId}`); return data; },
    enabled: !!unitId,
  });

  const { data: assets } = useQuery<Asset[]>({
    queryKey: ['assets', unitId],
    queryFn: async () => { const { data } = await apiClient.get(`/assets/?unit_id=${unitId}`); return data; },
    enabled: !!unitId,
  });

  const { data: vulns } = useQuery<Vulnerability[]>({
    queryKey: ['vulns-unit', unitId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/vulnerabilities/?unit_id=${unitId}`);
      return data || [];
    },
    enabled: !!unitId,
  });

  const { data: syncTasks } = useQuery<SyncTask[]>({
    queryKey: ['sync-tasks', unitId, taskStatus, taskQ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (taskStatus) params.set('status', taskStatus);
      if (taskQ) params.set('q', taskQ);
      const { data } = await apiClient.get(`/sync/tasks/${unitId}?${params.toString()}`);
      return data;
    },
    enabled: !!unitId,
    refetchInterval: query => {
      const tasks = query.state.data as SyncTask[] | undefined;
      return tasks?.some(task => ['pending', 'running'].includes(task.status)) ? 3000 : false;
    },
  });

  const { data: syncSchedule } = useQuery<SyncSchedule>({
    queryKey: ['sync-schedule'],
    queryFn: async () => {
      const { data } = await apiClient.get('/sync/schedule');
      return data;
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => apiClient.post(`/sync/trigger/${unitId}`),
    onSuccess: (res: any) => {
      message.success(res.data?.message || '同步完成');
      queryClient.invalidateQueries({ queryKey: ['unit', unitId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['vulns-unit'] });
      queryClient.invalidateQueries({ queryKey: ['sync-tasks', unitId] });
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.post(`/sync/retry/${taskId}`),
    onSuccess: (res: any) => {
      message.success(res.data?.message || '已提交重试任务');
      queryClient.invalidateQueries({ queryKey: ['sync-tasks', unitId] });
      queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '20vh auto' }} />;
  if (!unit) return <Typography.Text type="danger">单位未找到</Typography.Text>;

  const riskColors: Record<string, string> = { '严重': 'red', '高危': 'orange', '中危': 'blue', '低危': 'green' };
  const vulnStatusColors: Record<string, string> = {
    待确认: 'orange',
    待整改: 'volcano',
    整改中: 'blue',
    待复测: 'purple',
    已修复: 'green',
    误报: 'default',
    接受风险: 'cyan',
  };
  const taskStatusColors: Record<string, string> = { success: 'green', failed: 'red', running: 'blue', pending: 'orange' };
  const taskStatusLabels: Record<string, string> = { success: '成功', failed: '失败', running: '运行中', pending: '等待中' };
  const statusOptions = [
    { value: 'failed', label: '失败' },
    { value: 'success', label: '成功' },
    { value: 'running', label: '运行中' },
    { value: 'pending', label: '等待中' },
  ];
  const scheduleItem = syncSchedule?.units.find(item => item.unit_id === unit.id);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          <BankOutlined style={{ color: '#2f54eb', marginRight: 8 }} />{unit.name}
          <Tag color={unit.status === 'active' ? 'green' : 'default'} style={{ marginLeft: 8 }}>{unit.status === 'active' ? '活跃' : '停用'}</Tag>
        </Typography.Title>
        <Space>
          <Button icon={<SyncOutlined />} loading={syncMutation.isPending} onClick={() => syncMutation.mutate()}>同步 Space 数据</Button>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/units')}>返回列表</Button>
        </Space>
      </div>

      <Card style={{ borderRadius: 14, marginBottom: 20 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="编码">{unit.code}</Descriptions.Item>
          <Descriptions.Item label="描述">{unit.desc || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系人">{unit.contact || '-'} / {unit.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="IP 范围">{(unit.ip_ranges || []).map((ip: string) => <Tag key={ip} color="blue">{ip}</Tag>)}</Descriptions.Item>
          <Descriptions.Item label="单位别名">{(unit.aliases || []).length ? unit.aliases.map(alias => <Tag key={alias}>{alias}</Tag>) : '-'}</Descriptions.Item>
          <Descriptions.Item label="归属关键词">{(unit.keywords || []).length ? unit.keywords.map(keyword => <Tag key={keyword} color="cyan">{keyword}</Tag>) : '-'}</Descriptions.Item>
          <Descriptions.Item label="最近同步">{unit.last_sync ? new Date(unit.last_sync).toLocaleString('zh-CN') : <span style={{ color: '#faad14' }}>未同步</span>}</Descriptions.Item>
          <Descriptions.Item label="自动同步">
            {!syncSchedule?.sync_enabled ? '手动同步' : (
              scheduleItem?.active_task_status
                ? <Tag color="blue">{scheduleItem.active_task_status === 'running' ? '同步中' : '等待中'}</Tag>
                : scheduleItem?.due
                  ? <Tag color="orange">已到期</Tag>
                  : (scheduleItem?.next_sync ? new Date(scheduleItem.next_sync).toLocaleString('zh-CN') : '待首次同步')
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs defaultActiveKey="assets" items={[
        {
          key: 'assets', label: `资产列表（${assets?.length || 0}）`,
          children: <Table dataSource={assets || []} rowKey="id" size="small"
            columns={[
              { title: '名称', dataIndex: 'name', render: (v: string, r: Asset) => <a onClick={() => navigate(`/assets/${r.id}`)}>{v}</a> },
              { title: 'IP', dataIndex: 'ip', render: (v: string) => <code>{v}</code> },
              { title: '类型', dataIndex: 'type' },
              { title: '端口', dataIndex: 'ports', ellipsis: true, render: (v: string) => v ? <code>{v}</code> : '-' },
              { title: '风险', dataIndex: 'risk', render: (v: string) => <Tag color={riskColors[v]}>{v}</Tag> },
            ]}
            locale={{ emptyText: '暂无资产，点击上方同步按钮获取' }} />,
        },
        {
          key: 'vulns', label: `漏洞列表（${vulns?.length || 0}）`,
          children: <Table dataSource={vulns || []} rowKey="id" size="small"
            columns={[
              { title: '标题', dataIndex: 'title', render: (v: string, r: Vulnerability) => <a onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(r.cve || v)}`)}>{v}</a> },
              { title: 'CVE', dataIndex: 'cve', render: (v: string) => v ? <a onClick={() => navigate(`/vulnerabilities?q=${encodeURIComponent(v)}`)}><code>{v}</code></a> : '-' },
              { title: 'CVSS', dataIndex: 'cvss', render: (v: number) => <span style={{ fontWeight: 700, color: v >= 9 ? '#ea4335' : '#333' }}>{v?.toFixed(1)}</span> },
              { title: '等级', dataIndex: 'severity', render: (v: string) => <Tag color={riskColors[v]}>{v}</Tag> },
              { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={vulnStatusColors[v] || 'default'}>{v}</Tag> },
            ]}
            locale={{ emptyText: '暂无漏洞' }} />,
        },
        {
          key: 'sync', label: `同步记录（${syncTasks?.length || 0}）`,
          children: (
            <>
              <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                <Select
                  placeholder="状态"
                  value={taskStatus || undefined}
                  onChange={value => setTaskStatus(value || '')}
                  style={{ width: 130 }}
                  allowClear
                  options={statusOptions}
                />
                <Input
                  prefix={<SearchOutlined />}
                  placeholder="查询条件/错误"
                  value={taskQ}
                  onChange={e => setTaskQ(e.target.value)}
                  style={{ width: 240, borderRadius: 10 }}
                  allowClear
                />
                <Button icon={<ReloadOutlined />} onClick={() => queryClient.invalidateQueries({ queryKey: ['sync-tasks', unitId] })}>刷新</Button>
              </Space>
              <Table dataSource={syncTasks || []} rowKey="id" size="small"
                expandable={{
                  expandedRowRender: (task: SyncTask) => (
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="任务ID"><code>{task.id}</code></Descriptions.Item>
                      <Descriptions.Item label="查询条件">{task.query_condition ? <code>{task.query_condition}</code> : '-'}</Descriptions.Item>
                      <Descriptions.Item label="执行结果">{task.message || '-'}</Descriptions.Item>
                      <Descriptions.Item label="错误详情">
                        {task.error_detail ? (
                          <Typography.Paragraph type="danger" copyable style={{ margin: 0 }}>
                            {task.error_detail}
                          </Typography.Paragraph>
                        ) : '-'}
                      </Descriptions.Item>
                    </Descriptions>
                  ),
                  rowExpandable: (task: SyncTask) => Boolean(task.error_detail || task.query_condition || task.message),
                }}
                columns={[
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 90,
                    render: (v: string) => <Tag color={taskStatusColors[v] || 'default'}>{taskStatusLabels[v] || v}</Tag>,
                  },
                  { title: '查询条件', dataIndex: 'query_condition', ellipsis: true, render: (v: string) => v ? <code>{v}</code> : '-' },
                  { title: '拉取资产', dataIndex: 'fetched_assets', width: 90 },
                  { title: '入库资产', dataIndex: 'synced_assets', width: 90 },
                  { title: '入库漏洞', dataIndex: 'synced_vulns', width: 90 },
                  {
                    title: '结果',
                    dataIndex: 'message',
                    ellipsis: true,
                    render: (v: string, r: SyncTask) => (
                      <Typography.Text type={r.status === 'failed' ? 'danger' : undefined}>{r.error_detail || v || '-'}</Typography.Text>
                    ),
                  },
                  { title: '更新时间', dataIndex: 'updated_at', width: 180, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
                  {
                    title: '操作',
                    key: 'action',
                    width: 90,
                    render: (_: unknown, task: SyncTask) => (
                      <Button
                        size="small"
                        disabled={!['failed', 'success'].includes(task.status)}
                        loading={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(task.id)}
                      >
                        重试
                      </Button>
                    ),
                  },
                ]}
                locale={{ emptyText: taskStatus || taskQ ? '未找到匹配的同步记录' : '暂无同步记录' }} />
            </>
          ),
        },
      ]} />
    </>
  );
}

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DatabaseOutlined, ReloadOutlined, RetweetOutlined, SearchOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { AssetQualityIssue, AssetQualityReport, SyncTask, SyncTaskSummary, Unit } from '@/types';

const taskStatusColors: Record<string, string> = { success: 'green', failed: 'red', running: 'blue', pending: 'orange' };
const taskStatusLabels: Record<string, string> = { success: '成功', failed: '失败', running: '运行中', pending: '等待中' };
const statusOptions = [
  { value: 'failed', label: '失败' },
  { value: 'success', label: '成功' },
  { value: 'running', label: '运行中' },
  { value: 'pending', label: '等待中' },
];

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

function formatDuration(seconds?: number) {
  const total = Number(seconds || 0);
  if (total <= 0) return '-';
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}m ${remain}s`;
}

export default function DataOps() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const canOperate = currentUser?.role === 'super_admin' || currentUser?.role === 'operator';
  const [taskStatus, setTaskStatus] = useState('');
  const [taskUnitId, setTaskUnitId] = useState('');
  const [taskQ, setTaskQ] = useState('');

  const { data: units } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: async () => {
      const { data } = await apiClient.get('/units/');
      return data;
    },
  });

  const unitOptions = useMemo(() => [
    { value: '__unassigned', label: '未指定单位' },
    ...(units || []).map(unit => ({ value: unit.id, label: unit.name })),
  ], [units]);

  const { data: taskSummary } = useQuery<SyncTaskSummary>({
    queryKey: ['sync-task-summary'],
    queryFn: async () => {
      const { data } = await apiClient.get('/sync/task-summary');
      return data;
    },
    refetchInterval: 5000,
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<SyncTask[]>({
    queryKey: ['sync-tasks-all', taskStatus, taskUnitId, taskQ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (taskStatus) params.set('status', taskStatus);
      if (taskUnitId) params.set('unit_id', taskUnitId);
      if (taskQ) params.set('q', taskQ);
      const { data } = await apiClient.get('/sync/tasks?' + params.toString());
      return data;
    },
    refetchInterval: query => {
      const rows = query.state.data as SyncTask[] | undefined;
      return rows?.some(task => ['pending', 'running'].includes(task.status)) ? 3000 : false;
    },
  });

  const { data: qualityReport, isLoading: qualityLoading } = useQuery<AssetQualityReport>({
    queryKey: ['asset-quality-report'],
    queryFn: async () => {
      const { data } = await apiClient.get('/assets/quality/report');
      return data;
    },
  });

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.post(`/sync/retry/${taskId}`),
    onSuccess: (res: any) => {
      message.success(res.data?.message || '已提交重试任务');
      queryClient.invalidateQueries({ queryKey: ['sync-task-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sync-tasks-all'] });
    },
    onError: (err: any) => message.error(err.response?.data?.detail || '重试失败'),
  });

  const refreshTasks = () => {
    queryClient.invalidateQueries({ queryKey: ['sync-task-summary'] });
    queryClient.invalidateQueries({ queryKey: ['sync-tasks-all'] });
  };

  const refreshQuality = () => {
    queryClient.invalidateQueries({ queryKey: ['asset-quality-report'] });
  };

  return (
    <>
      <Typography.Title level={3} style={{ marginBottom: 24 }}>
        <DatabaseOutlined style={{ color: '#1677ff', marginRight: 8 }} /> 数据接入
      </Typography.Title>

      <Tabs
        defaultActiveKey="tasks"
        items={[
          {
            key: 'tasks',
            label: '同步任务中心',
            children: (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))', gap: 16, marginBottom: 16 }}>
                  <Card style={{ borderRadius: 14 }}><Statistic title="任务总数" value={taskSummary?.total || 0} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="运行中" value={(taskSummary?.running || 0) + (taskSummary?.pending || 0)} valueStyle={{ color: '#1677ff' }} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="成功" value={taskSummary?.success || 0} valueStyle={{ color: '#34C759' }} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="失败" value={taskSummary?.failed || 0} valueStyle={{ color: '#ff4d4f' }} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="完成成功率" value={taskSummary?.success_rate || 0} suffix="%" precision={2} /></Card>
                </div>
                <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                  <Select
                    placeholder="状态"
                    value={taskStatus || undefined}
                    onChange={value => setTaskStatus(value || '')}
                    style={{ width: 130 }}
                    allowClear
                    options={statusOptions}
                  />
                  <Select
                    placeholder="单位"
                    value={taskUnitId || undefined}
                    onChange={value => setTaskUnitId(value || '')}
                    style={{ width: 190 }}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={unitOptions}
                  />
                  <Input
                    prefix={<SearchOutlined />}
                    placeholder="任务ID/查询条件/失败详情"
                    value={taskQ}
                    onChange={e => setTaskQ(e.target.value)}
                    style={{ width: 260, borderRadius: 10 }}
                    allowClear
                  />
                  <Button icon={<ReloadOutlined />} onClick={refreshTasks}>刷新</Button>
                </Space>
                <Table
                  dataSource={tasks || []}
                  rowKey="id"
                  loading={tasksLoading}
                  style={{ background: '#fff', borderRadius: 14 }}
                  scroll={{ x: 1120 }}
                  expandable={{
                    expandedRowRender: (task: SyncTask) => (
                      <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="任务ID"><code>{task.id}</code></Descriptions.Item>
                        <Descriptions.Item label="查询条件">{task.query_condition ? <code>{task.query_condition}</code> : '-'}</Descriptions.Item>
                        <Descriptions.Item label="执行结果">{task.message || '-'}</Descriptions.Item>
                        <Descriptions.Item label="失败详情">
                          {task.error_detail ? (
                            <Typography.Paragraph type="danger" copyable style={{ margin: 0 }}>
                              {task.error_detail}
                            </Typography.Paragraph>
                          ) : '-'}
                        </Descriptions.Item>
                      </Descriptions>
                    ),
                    rowExpandable: (task: SyncTask) => Boolean(task.query_condition || task.message || task.error_detail),
                  }}
                  columns={[
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 92,
                      render: (value: string) => <Tag color={taskStatusColors[value] || 'default'}>{taskStatusLabels[value] || value}</Tag>,
                    },
                    { title: '单位', dataIndex: 'unit_name', width: 180, ellipsis: true, render: (value: string, row: SyncTask) => row.unit_id ? (value || row.unit_id) : <Tag>未指定单位</Tag> },
                    { title: '查询条件', dataIndex: 'query_condition', ellipsis: true, render: (value: string) => value ? <code>{value}</code> : '-' },
                    { title: '拉取资产', dataIndex: 'fetched_assets', width: 90 },
                    { title: '入库资产', dataIndex: 'synced_assets', width: 90 },
                    { title: '入库漏洞', dataIndex: 'synced_vulns', width: 90 },
                    { title: '耗时', dataIndex: 'duration_seconds', width: 90, render: (value: number) => formatDuration(value) },
                    { title: '更新时间', dataIndex: 'updated_at', width: 180, render: formatTime },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 110,
                      fixed: 'right',
                      render: (_: unknown, task: SyncTask) => (
                        <Tooltip title={canOperate ? '' : '当前账号无重试权限'}>
                          <Button
                            size="small"
                            icon={<RetweetOutlined />}
                            disabled={!canOperate || !['failed', 'success'].includes(task.status)}
                            loading={retryMutation.isPending && retryMutation.variables === task.id}
                            onClick={() => retryMutation.mutate(task.id)}
                          >
                            重试
                          </Button>
                        </Tooltip>
                      ),
                    },
                  ]}
                  locale={{ emptyText: taskStatus || taskUnitId || taskQ ? '未找到匹配的同步任务' : '暂无同步任务' }}
                />
              </>
            ),
          },
          {
            key: 'quality',
            label: '数据接入质量',
            children: (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(140px, 1fr))', gap: 16, marginBottom: 16 }}>
                  <Card style={{ borderRadius: 14 }}><Statistic title="资产总数" value={qualityReport?.total_assets || 0} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="有单位" value={qualityReport?.assigned_assets || 0} valueStyle={{ color: '#34C759' }} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="未归属" value={qualityReport?.unassigned_assets || 0} valueStyle={{ color: '#faad14' }} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="归属率" value={qualityReport?.assigned_rate || 0} suffix="%" precision={2} /></Card>
                  <Card style={{ borderRadius: 14 }}><Statistic title="重复IP组" value={qualityReport?.duplicate_group_count || 0} /></Card>
                </div>
                <Space style={{ marginBottom: 16 }}>
                  <Button icon={<ReloadOutlined />} onClick={refreshQuality}>刷新质量统计</Button>
                  <Typography.Text type="secondary">
                    RaySpace 单位字段：有值 {qualityReport?.raw_org_non_empty || 0}，空值 {qualityReport?.raw_org_empty || 0}，疑似域名/通配符 {qualityReport?.raw_org_domain_like || 0}
                  </Typography.Text>
                </Space>
                <Table
                  dataSource={qualityReport?.issues || []}
                  rowKey="key"
                  loading={qualityLoading}
                  style={{ background: '#fff', borderRadius: 14 }}
                  expandable={{
                    expandedRowRender: (issue: AssetQualityIssue) => (
                      <Table
                        dataSource={issue.samples}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        columns={[
                          { title: '资产名称', dataIndex: 'name', render: (value: string, row) => <a onClick={() => navigate(`/assets/${row.id}`)}>{value || row.ip}</a> },
                          { title: 'IP', dataIndex: 'ip', render: (value: string) => <code>{value}</code> },
                          { title: '单位ID', dataIndex: 'unit_id', render: (value: string | null) => value || <Tag>未归属</Tag> },
                          { title: '问题', dataIndex: 'issue' },
                        ]}
                        locale={{ emptyText: '暂无样例' }}
                      />
                    ),
                    rowExpandable: (issue: AssetQualityIssue) => issue.samples.length > 0,
                  }}
                  columns={[
                    { title: '质量项', dataIndex: 'label', width: 180 },
                    { title: '数量', dataIndex: 'count', width: 120 },
                    { title: '占比', dataIndex: 'rate', width: 120, render: (value: number) => `${value}%` },
                    {
                      title: '处理建议',
                      key: 'suggestion',
                      render: (_: unknown, issue: AssetQualityIssue) => {
                        const suggestions: Record<string, string> = {
                          missing_unit: '在资产管理筛选未归属资产后批量归属，或维护单位别名/关键词后重新拉取。',
                          missing_ports: '检查 RaySpace 查询条件是否包含端口/服务字段，必要时人工补录。',
                          missing_location: '补充区域字段或通过经纬度反查区域。',
                          missing_coordinates: '优先修正 RaySpace 经纬度字段映射，地图展示依赖该字段。',
                          missing_manufacturer: '核对 application_info 中厂商、品牌、型号字段。',
                          missing_raw: '检查原始接口返回和入库解析流程。',
                        };
                        return suggestions[issue.key] || '-';
                      },
                    },
                  ]}
                  locale={{ emptyText: '暂无质量统计' }}
                />
              </>
            ),
          },
        ]}
      />
    </>
  );
}

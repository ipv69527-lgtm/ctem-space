import React from 'react';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Tag } from 'antd';
import { DashboardOutlined, BankOutlined, DesktopOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

interface DashboardStats {
  total_assets: number;
  total_units: number;
  total_vulns: number;
  critical_high: number;
  top_risk_units?: {
    id: string;
    name: string;
    asset_count: number;
    vuln_count: number;
    critical_vuln: number;
    high_vuln: number;
    score: number;
  }[];
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const { data } = await apiClient.get('/dashboard/stats');
      return data;
    },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '20vh auto' }} />;

  const cards = [
    { label: '资产总数', value: stats?.total_assets ?? '-', icon: <DesktopOutlined />, color: '#007AFF' },
    { label: '活跃单位数', value: stats?.total_units ?? '-', icon: <BankOutlined />, color: '#34C759' },
    { label: '漏洞总数', value: stats?.total_vulns ?? '-', icon: <WarningOutlined />, color: '#FF9500' },
    { label: '严重/高危漏洞', value: stats?.critical_high ?? '-', icon: <WarningOutlined />, color: '#FF3B30' },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          <DashboardOutlined style={{ color: '#1677ff', marginRight: 8 }} /> 全局态势
        </Typography.Title>
        <Typography.Text type="secondary">
          欢迎，{user?.name || user?.username} · 数据更新时间：{new Date().toLocaleString('zh-CN')}
        </Typography.Text>
      </div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {cards.map((s, i) => (
          <Col span={6} key={i}>
            <Card hoverable style={{ borderRadius: 14 }}>
              <Statistic title={s.label} value={s.value}
                valueStyle={{ color: s.color, fontWeight: 700 }}
                prefix={React.cloneElement(s.icon as any, { style: { color: s.color } })} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="Top 风险单位" style={{ borderRadius: 14 }}>
        <Table
          dataSource={stats?.top_risk_units || []}
          rowKey="id"
          columns={[
            { title: '#', width: 60, render: (_: any, __: any, index: number) => index + 1 },
            { title: '单位', dataIndex: 'name' },
            { title: '资产数', dataIndex: 'asset_count' },
            { title: '漏洞数', dataIndex: 'vuln_count' },
            { title: '严重', dataIndex: 'critical_vuln', render: (v: number) => <Tag color={v ? 'red' : 'default'}>{v}</Tag> },
            { title: '高危', dataIndex: 'high_vuln', render: (v: number) => <Tag color={v ? 'orange' : 'default'}>{v}</Tag> },
            { title: '风险分', dataIndex: 'score' },
          ]}
          locale={{ emptyText: '暂无风险单位数据' }}
        />
      </Card>
    </>
  );
}

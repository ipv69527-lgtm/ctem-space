import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, theme } from 'antd';
import type { MenuProps } from 'antd';
import { DashboardOutlined, BankOutlined, DesktopOutlined, SafetyOutlined,
  FileTextOutlined, EditOutlined, TeamOutlined, SettingOutlined, AuditOutlined,
  FundViewOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/stores/authStore';
import GlobalSearch from '@/components/Layout/GlobalSearch';

const { Sider, Header, Content } = Layout;

const iconColors: Record<string, string> = {
  '/dashboard': '#1677ff', '/screen': '#13c2c2', '/units': '#2f54eb',
  '/assets': '#13c2c2', '/vulnerabilities': '#f5222d', '/reports': '#fa8c16',
  '/templates': '#722ed1', '/users': '#52c41a', '/audit': '#1677ff', '/settings': '#8c8c8c',
};

function coloredIcon(Icon: any, key: string) {
  return <Icon style={{ color: iconColors[key] || '#8c8c8c', fontSize: 16 }} />;
}

const menuItems: MenuProps['items'] = [
  { key: '/dashboard', icon: coloredIcon(DashboardOutlined, '/dashboard'), label: '全局态势' },
  { key: '/screen', icon: coloredIcon(FundViewOutlined, '/screen'), label: '大屏展示' },
  { key: '/units', icon: coloredIcon(BankOutlined, '/units'), label: '单位管理' },
  { key: '/assets', icon: coloredIcon(DesktopOutlined, '/assets'), label: '资产管理' },
  { key: '/vulnerabilities', icon: coloredIcon(SafetyOutlined, '/vulnerabilities'), label: '漏洞管理' },
  { key: '/reports', icon: coloredIcon(FileTextOutlined, '/reports'), label: '报表管理' },
  { key: '/templates', icon: coloredIcon(EditOutlined, '/templates'), label: '报表模板' },
  { key: '/users', icon: coloredIcon(TeamOutlined, '/users'), label: '用户管理' },
  { key: '/audit', icon: coloredIcon(AuditOutlined, '/audit'), label: '审计日志' },
  { key: '/settings', icon: coloredIcon(SettingOutlined, '/settings'), label: '系统设置' },
];

const roleFilter = (role: string) => {
  if (role === 'auditor') return menuItems.filter((m) => !['/users', '/templates', '/audit', '/settings'].includes(m?.key as string));
  if (role === 'operator') return menuItems.filter((m) => !['/users', '/audit', '/settings'].includes(m?.key as string));
  return menuItems;
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const { token: themeToken } = theme.useToken();
  const selectedKey = '/' + location.pathname.split('/')[1];

  const userMenu: MenuProps['items'] = [
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout },
  ];

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={248}
        style={{ background: 'rgba(242,242,247,.8)', backdropFilter: 'blur(40px)', borderRight: '1px solid rgba(0,0,0,.06)' }}>
        <div style={{ padding: '16px 20px', fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: themeToken.colorPrimary, display: 'inline-block' }} />
          {!collapsed && 'CTEM 平台'}
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={user ? roleFilter(user.role) : menuItems}
          onClick={({ key }) => navigate(key)} style={{ background: 'transparent', border: 'none' }} />
      </Sider>
      <Layout>
        <Header style={{ height: 52, background: 'rgba(255,255,255,.75)', backdropFilter: 'blur(30px)', borderBottom: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', lineHeight: 'normal' }}>
          <GlobalSearch />
          <Dropdown menu={{ items: userMenu }} placement="bottomRight">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: 'rgba(0,122,255,.08)', color: themeToken.colorPrimary, fontWeight: 600 }}>
                {user?.role === 'super_admin' ? '超级管理员' : user?.role === 'operator' ? '运营人员' : '审计员'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{user?.name || user?.username}</span>
              <Avatar size={30} style={{ backgroundColor: themeToken.colorPrimary }}>
                {(user?.name || user?.username || 'U')[0].toUpperCase()}
              </Avatar>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

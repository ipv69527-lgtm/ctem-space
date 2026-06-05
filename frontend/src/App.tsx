import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Result, Spin } from 'antd';
import AppLayout from '@/components/Layout/AppLayout';
import { useAuthStore } from '@/stores/authStore';
import apiClient from '@/api/client';

// Lazy-loaded pages
const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Screen = lazy(() => import('@/pages/Screen'));
const Units = lazy(() => import('@/pages/Units'));
const UnitDetail = lazy(() => import('@/pages/Units/UnitDetail'));
const Assets = lazy(() => import('@/pages/Assets'));
const AssetDetail = lazy(() => import('@/pages/Assets/AssetDetail'));
const Vulnerabilities = lazy(() => import('@/pages/Vulnerabilities'));
const Reports = lazy(() => import('@/pages/Reports'));
const Templates = lazy(() => import('@/pages/Templates'));
const Users = lazy(() => import('@/pages/Users'));
const Audit = lazy(() => import('@/pages/Audit'));
const Settings = lazy(() => import('@/pages/Settings'));

const PageLoader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
    <Spin size="large" />
  </div>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRoute({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <PageLoader />;
  if (!allowed.includes(user.role)) {
    return <Result status="403" title="无权限访问" subTitle="当前账号没有访问该功能的权限" />;
  }
  return <>{children}</>;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!token || user) return;
    apiClient.get('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => logout());
  }, [token, user, setUser, logout]);

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="screen" element={<Screen />} />
          <Route path="units" element={<Units />} />
          <Route path="units/:unitId" element={<UnitDetail />} />
          <Route path="assets" element={<Assets />} />
          <Route path="assets/:assetId" element={<AssetDetail />} />
          <Route path="vulnerabilities" element={<Vulnerabilities />} />
          <Route path="reports" element={<Reports />} />
          <Route path="templates" element={<RoleRoute allowed={['super_admin', 'operator']}><Templates /></RoleRoute>} />
          <Route path="users" element={<RoleRoute allowed={['super_admin']}><Users /></RoleRoute>} />
          <Route path="audit" element={<RoleRoute allowed={['super_admin']}><Audit /></RoleRoute>} />
          <Route path="settings" element={<RoleRoute allowed={['super_admin']}><Settings /></RoleRoute>} />
        </Route>
      </Routes>
    </Suspense>
  );
}

import { useState, useRef } from 'react';
import { Empty, Input, Dropdown, Spin, Typography } from 'antd';
import { SearchOutlined, BankOutlined, DesktopOutlined, SafetyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '@/api/client';

interface SearchItem {
  id: string; name?: string; title?: string; code?: string; ip?: string;
  cve?: string; severity?: string; risk?: string; type: string; unit_id?: string;
}

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ units: SearchItem[]; assets: SearchItem[]; vulns: SearchItem[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const timerRef = useRef<any>(null);

  const doSearch = (val: string) => {
    setQ(val);
    setError('');
    if (!val || val.length < 1) { setResults(null); setOpen(false); return; }
    setLoading(true);
    setOpen(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/search/?q=${encodeURIComponent(val)}`);
        setResults(data);
        setOpen(true);
      } catch {
        setResults(null);
        setError('搜索失败，请稍后重试');
        setOpen(true);
      }
      setLoading(false);
    }, 300);
  };

  const goTo = (item: SearchItem) => {
    setOpen(false); setQ('');
    if (item.type === 'unit') navigate(`/units/${item.id}`);
    else if (item.type === 'asset') navigate(`/assets/${item.id}`);
    else if (item.type === 'vuln') navigate(`/vulnerabilities?q=${encodeURIComponent(item.cve || item.title || q)}`);
  };

  const goToSearchPage = () => {
    const keyword = q.trim();
    if (!keyword) return;
    const first = results?.units[0] || results?.assets[0] || results?.vulns[0];
    if (first) {
      goTo(first);
      return;
    }
    setOpen(false);
    navigate(`/assets?q=${encodeURIComponent(keyword)}`);
  };

  const dropdownContent = (
    <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,.1)', border: '1px solid rgba(0,0,0,.04)', maxHeight: 420, overflow: 'auto', minWidth: 480 }}>
      {loading && (
        <div style={{ padding: 18, textAlign: 'center' }}>
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>搜索中...</Typography.Text>
        </div>
      )}
      {!loading && error && (
        <div style={{ padding: 18 }}>
          <Typography.Text type="danger">{error}</Typography.Text>
        </div>
      )}
      {!loading && !error && results && results.total === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配结果" style={{ margin: '14px 0' }} />
      )}
      {!loading && !error && results && results.units.length > 0 && (
        <div>
          <div style={{ padding: '8px 16px 4px', fontSize: 11, color: '#8c8c8c', fontWeight: 600, letterSpacing: '.3px' }}>
            <BankOutlined style={{ marginRight: 4 }} />单位
          </div>
          {results.units.map(u => (
            <div key={u.id} onClick={() => goTo(u)} style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f3f4')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span>{u.name}</span><span style={{ color: '#8c8c8c' }}>{u.code}</span>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && results && results.assets.length > 0 && (
        <div>
          <div style={{ padding: '8px 16px 4px', fontSize: 11, color: '#8c8c8c', fontWeight: 600, letterSpacing: '.3px' }}>
            <DesktopOutlined style={{ marginRight: 4 }} />资产
          </div>
          {results.assets.map(a => (
            <div key={a.id} onClick={() => goTo(a)} style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f3f4')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span>{a.name} <code style={{ fontSize: 11 }}>{a.ip}</code></span><span style={{ color: '#8c8c8c' }}>{a.risk}</span>
            </div>
          ))}
        </div>
      )}
      {!loading && !error && results && results.vulns.length > 0 && (
        <div>
          <div style={{ padding: '8px 16px 4px', fontSize: 11, color: '#8c8c8c', fontWeight: 600, letterSpacing: '.3px' }}>
            <SafetyOutlined style={{ marginRight: 4 }} />漏洞
          </div>
          {results.vulns.map(v => (
            <div key={v.id} onClick={() => goTo(v)} style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f1f3f4')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span>{v.title}</span><span style={{ color: '#8c8c8c', fontSize: 11 }}>{v.cve} · {v.severity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dropdown open={open} onOpenChange={setOpen} dropdownRender={() => dropdownContent} trigger={['click']}>
      <Input prefix={<SearchOutlined style={{ color: '#8e8e93' }} />} placeholder="搜索单位、资产、漏洞..." value={q}
        onChange={e => doSearch(e.target.value)} onFocus={() => results && results.total > 0 && setOpen(true)}
        onPressEnter={goToSearchPage}
        style={{ width: 480, borderRadius: 10, background: 'rgba(0,0,0,.02)' }} allowClear
        suffix={loading ? <Spin size="small" /> : null} />
    </Dropdown>
  );
}

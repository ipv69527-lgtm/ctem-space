import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('ctem_token'),
  isAuthenticated: !!localStorage.getItem('ctem_token'),

  setUser: (user) => set({ user }),

  login: (user, token) => {
    localStorage.setItem('ctem_token', token);
    set({ user, token, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('ctem_token');
    set({ user: null, token: null, isAuthenticated: false });
    window.location.href = '/login';
  },
}));

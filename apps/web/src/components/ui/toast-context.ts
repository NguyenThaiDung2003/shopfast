import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** ms; mặc định 5000. */
  duration?: number;
}

export interface ToastApi {
  show: (toast: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast phải nằm trong <ToastProvider>');
  return api;
}

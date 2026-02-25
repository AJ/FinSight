'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface UploadContextType {
  openUpload: () => void;
  closeUpload: () => void;
  isUploadOpen: boolean;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const openUpload = () => setIsUploadOpen(true);
  const closeUpload = () => setIsUploadOpen(false);

  return (
    <UploadContext.Provider value={{ openUpload, closeUpload, isUploadOpen }}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within UploadProvider');
  }
  return context;
}

'use client';

import { Sidebar } from './Sidebar';
import { UploadDialog } from './UploadDialog';
import { UploadProvider, useUpload } from './UploadContext';

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { isUploadOpen, closeUpload } = useUpload();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {children}
      <UploadDialog open={isUploadOpen} onOpenChange={(open) => !open && closeUpload()} />
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <UploadProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </UploadProvider>
  );
}

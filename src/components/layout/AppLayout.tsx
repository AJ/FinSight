'use client';

import { Sidebar } from './Sidebar';
import { UploadDialog } from './UploadDialog';
import { UploadProvider, useUpload } from './UploadContext';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { useOnboardingStore } from '@/lib/store/onboardingStore';

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { isUploadOpen, closeUpload, isProcessing } = useUpload();
  const hasCompletedOnboarding = useOnboardingStore((state) => state.hasCompletedOnboarding);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {children}
      <UploadDialog open={isUploadOpen} onOpenChange={closeUpload} isProcessing={isProcessing} />
      <OnboardingWizard open={!hasCompletedOnboarding} onOpenChange={() => {}} />
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

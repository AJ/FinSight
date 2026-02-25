'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileProcessor } from '@/components/upload/FileProcessor';
import { AIConnectionBar } from '@/components/upload/AIConnectionBar';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadDialog({ open, onOpenChange }: UploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <AIConnectionBar />
          <FileProcessor />
          <p className="text-xs text-muted-foreground text-center">
            Supports PDF, CSV • All processing happens locally on your device
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

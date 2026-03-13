'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileProcessor } from '@/components/upload/FileProcessor';
import { AIConnectionBar } from '@/components/upload/AIConnectionBar';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing?: boolean;
}

export function UploadDialog({ open, onOpenChange, isProcessing = false }: UploadDialogProps) {
  const [localProcessing, setLocalProcessing] = useState(false);
  
  // Use local state if parent doesn't provide isProcessing
  const effectiveProcessing = isProcessing || localProcessing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <AIConnectionBar disabled={effectiveProcessing} />
          <FileProcessor 
            onSuccess={() => onOpenChange(false)}
            onProcessingChange={setLocalProcessing}
          />
          <p className="text-xs text-muted-foreground text-center">
            Supports PDF, CSV, XLS, XLSX • All processing happens locally on your device
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

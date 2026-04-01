'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileProcessor } from '@/components/upload/FileProcessor';
import { AIConnectionBar } from '@/components/upload/AIConnectionBar';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing?: boolean;
}

export function UploadDialog({ open, onOpenChange, isProcessing = false }: UploadDialogProps) {
  const [localProcessing, setLocalProcessing] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Use local state if parent doesn't provide isProcessing
  const effectiveProcessing = isProcessing || localProcessing;

  const handleRequestClose = () => {
    if (effectiveProcessing) {
      setShowCancelConfirm(true);
      return;
    }
    onOpenChange(false);
  };

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            onOpenChange(true);
            return;
          }
          handleRequestClose();
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Upload Statement</DialogTitle>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 h-8 w-8"
            onClick={handleRequestClose}
            aria-label="Close upload dialog"
          >
            <XIcon className="h-4 w-4" />
          </Button>
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

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Cancel Processing?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Statement processing is still in progress. If you cancel now, the current run will be aborted and any in-progress results will be discarded.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
                Continue Processing
              </Button>
              <Button variant="destructive" onClick={handleConfirmCancel}>
                Yes, Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

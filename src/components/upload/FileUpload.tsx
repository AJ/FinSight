'use client';

import { useCallback, useState } from 'react';
import { Upload, FileText, FileSpreadsheet, File as FileIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const VALID_EXTENSIONS = ['.csv', '.pdf', '.xls', '.xlsx'];

// MIME type validation to prevent extension spoofing
const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.xls': ['application/vnd.ms-excel', 'application/msexcel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

function validateAndSelectFile(file: File, onFileSelect: (file: File) => void): boolean {
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (!VALID_EXTENSIONS.includes(fileExtension)) {
    alert('Please upload a valid file (CSV, PDF, XLS, or XLSX)');
    return false;
  }

  // Validate MIME type to prevent extension spoofing
  const allowedMimes = ALLOWED_MIME_TYPES[fileExtension];
  // Some browsers may return empty string for type, so we allow that
  if (file.type && allowedMimes && !allowedMimes.includes(file.type)) {
    alert('File content does not match its extension. Please upload a valid file.');
    return false;
  }

  if (file.size > MAX_FILE_SIZE) {
    alert('File is too large. Maximum size is 50 MB.');
    return false;
  }

  onFileSelect(file);
  return true;
}

export function FileUpload({ onFileSelect, isProcessing = false }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        validateAndSelectFile(file, onFileSelect);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        validateAndSelectFile(file, onFileSelect);
      }
    },
    [onFileSelect]
  );

  return (
    <Card
      className={cn(
        'transition-all duration-200',
        isDragging && 'ring-2 ring-primary ring-offset-2',
        isProcessing && 'opacity-50 pointer-events-none'
      )}
    >
      <CardContent className="p-8">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'border-2 border-dashed rounded-lg p-12 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
          )}
        >
          <div className="flex flex-col items-center gap-4">
            <motion.div
              animate={{ y: isDragging ? -10 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <Upload className="w-16 h-16 text-muted-foreground" />
            </motion.div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                {isProcessing ? 'Processing...' : 'Upload Your Statement'}
              </h3>
              <p className="text-sm text-muted-foreground">
                Drag and drop your file here, or click to browse
              </p>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="w-5 h-5" />
                <span>CSV</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileIcon className="w-5 h-5" />
                <span>PDF</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileSpreadsheet className="w-5 h-5" />
                <span>XLS/XLSX</span>
              </div>
            </div>

            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept=".csv,.pdf,.xls,.xlsx"
              onChange={handleFileInput}
              disabled={isProcessing}
            />

            <Button asChild disabled={isProcessing}>
              <label htmlFor="file-upload" className="cursor-pointer">
                Select File
              </label>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

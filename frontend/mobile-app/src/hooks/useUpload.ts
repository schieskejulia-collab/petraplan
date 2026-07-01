import { useState, useCallback } from "react";
import { validateFiles } from "@/utils/validators";

export interface ParsedUpload {
  fileName: string;
  data: Record<string, unknown>;
}

interface UseUploadReturn {
  files: File[];
  parsed: ParsedUpload[];
  errors: string[];
  isProcessing: boolean;
  addFiles: (incoming: FileList | File[]) => void;
  removeFile: (index: number) => void;
  clearAll: () => void;
}

export function useUpload(): UseUploadReturn {
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ParsedUpload[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const addFiles = useCallback(async (incoming: FileList | File[]) => {
    const newFiles = Array.from(incoming);
    const validationErrors = validateFiles(newFiles);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setIsProcessing(true);

    const results: ParsedUpload[] = [];
    for (const file of newFiles) {
      try {
        const text = await file.text();
        let data: Record<string, unknown> = {};
        if (file.type === "application/json" || file.name.endsWith(".json")) {
          data = JSON.parse(text);
        } else {
          // CSV / plain text: wrap as description
          data = { description: text.slice(0, 2000) };
        }
        results.push({ fileName: file.name, data });
      } catch {
        setErrors((prev) => [...prev, `Could not parse ${file.name}.`]);
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
    setParsed((prev) => [...prev, ...results]);
    setIsProcessing(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setParsed((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    setParsed([]);
    setErrors([]);
  }, []);

  return { files, parsed, errors, isProcessing, addFiles, removeFile, clearAll };
}
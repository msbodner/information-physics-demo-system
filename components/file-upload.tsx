"use client"

import { useCallback, useState } from "react" 
import { Upload, FileText, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void
  isProcessing: boolean
}

export function FileUpload({ onFilesSelected, isProcessing }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files).filter(
        (file) => file.type === "text/csv" || file.name.endsWith(".csv")
      )

      if (files.length > 0) {
        onFilesSelected(files)
      }
    },
    [onFilesSelected]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      if (files.length > 0) {
        onFilesSelected(files)
      }
    },
    [onFilesSelected]
  )

  return (
    <div className="space-y-6">
      <label
        className={cn(
          "relative flex flex-col items-center justify-center w-full min-h-[300px] rounded-xl border-2 border-dashed cursor-pointer transition-colors",
          isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/50",
          isProcessing && "pointer-events-none opacity-60"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input type="file" accept=".csv" multiple className="hidden" onChange={handleFileInput} disabled={isProcessing} />
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          {isProcessing ? (
            <>
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <p className="text-lg font-medium text-foreground">Processing files...</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="text-lg font-medium text-foreground">
                  Drop CSV files here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse your files
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="w-3 h-3" />
                Supports .csv files
              </div>
            </>
          )}
        </div>
      </label>

      <div className="rounded-lg bg-card border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">How it works</h3>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Upload one or more CSV files</li>
          <li>Each row is converted to a single AIO line</li>
          <li>Format: [Column1.Value1][Column2.Value2]...</li>
          <li>Download the .aio file or copy to clipboard</li>
        </ol>
      </div>
    </div>
  )
}

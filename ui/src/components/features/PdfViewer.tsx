import { useEffect, useState } from 'react';
import { wsService } from '../../services/wsService';
import { Loader2, AlertCircle } from 'lucide-react';

interface PdfViewerProps {
  filePath: string;
}

export default function PdfViewer({ filePath }: PdfViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;

    const handleContent = (payload: unknown) => {
      const p = payload as { path: string; content: string };
      if (p.path === filePath) {
        try {
          // Convert base64 to Blob
          const byteCharacters = atob(p.content);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          
          // Create Object URL
          objectUrl = URL.createObjectURL(blob);
          setPdfUrl(objectUrl);
          setLoading(false);
        } catch (e) {
          console.error('Failed to process PDF content', e);
          setError('Failed to process PDF content');
          setLoading(false);
        }
      }
    };
    
    const handleError = (payload: unknown) => {
      const msg = payload as string;
      if (msg.includes('read media file')) {
        setError(msg);
        setLoading(false);
      }
    };

    const unsubContent = wsService.on('media-file-content', handleContent);
    const unsubError = wsService.on('error', handleError);
    
    // Request the file content
    wsService.readMediaFile(filePath);
    
    return () => {
      unsubContent();
      unsubError();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e] text-zinc-500">
        <Loader2 className="animate-spin mr-2" /> Loading PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e] text-red-400">
        <AlertCircle className="mr-2" /> {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0e0e] overflow-hidden">
      {pdfUrl && (
        <iframe 
          src={pdfUrl} 
          className="w-full h-full border-none"
          title={`PDF: ${filePath}`}
        />
      )}
    </div>
  );
}

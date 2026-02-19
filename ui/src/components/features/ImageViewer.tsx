import { useEffect, useState, useRef } from 'react';
import { wsService } from '../../services/wsService';
import { Loader2, ZoomIn, ZoomOut, RotateCw, Crop, Save, Maximize, X } from 'lucide-react';
import { Button } from '../../surface-kit/primitives/Button';
import { Input } from '../../surface-kit/primitives/Input';
import { Label } from '../../surface-kit/primitives/Label';

interface ImageViewerProps {
  filePath: string;
}

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function ImageViewer({ filePath }: ImageViewerProps) {
  const [imgData, setImgData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Transform state
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  
  // Edit modes
  const [mode, setMode] = useState<'view' | 'crop' | 'resize'>('view');
  
  // Crop state
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  
  // Resize state
  const [resizeDims, setResizeDims] = useState<{width: number, height: number} | null>(null);
  
  const imageRef = useRef<HTMLImageElement | null>(null);

  const getFileExtension = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext === 'svg') return 'svg+xml';
    if (ext === 'jpg') return 'jpeg';
    return ext || 'png';
  };

  // Load image
  useEffect(() => {
    const handleContent = (payload: unknown) => {
      const p = payload as { path: string; content: string };
      if (p.path === filePath) {
        setImgData(`data:image/${getFileExtension(filePath)};base64,${p.content}`);
        setLoading(false);
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
    
    wsService.readMediaFile(filePath);
    
    return () => {
      unsubContent();
      unsubError();
    };
  }, [filePath]);

  const handleZoomIn = () => setScale(s => Math.min(s + 0.1, 5));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.1, 0.1));
  const handleRotate = () => setRotation(r => (r + 90) % 360);

  const handleCropStart = () => {
    if (mode === 'crop') {
      setMode('view');
      setCropRegion(null);
    } else {
      setMode('crop');
      // Initialize crop region to 80% of image center
      if (imageRef.current) {
        const { naturalWidth, naturalHeight } = imageRef.current;
        const w = Math.floor(naturalWidth * 0.8);
        const h = Math.floor(naturalHeight * 0.8);
        setCropRegion({
          x: Math.floor((naturalWidth - w) / 2),
          y: Math.floor((naturalHeight - h) / 2),
          width: w,
          height: h
        });
      }
    }
  };

  const handleResizeStart = () => {
    if (mode === 'resize') {
      setMode('view');
      setResizeDims(null);
    } else {
      setMode('resize');
      if (imageRef.current) {
        setResizeDims({
          width: imageRef.current.naturalWidth,
          height: imageRef.current.naturalHeight
        });
      }
    }
  };

  const applyCrop = () => {
    if (!imageRef.current || !cropRegion) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = cropRegion.width;
    canvas.height = cropRegion.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(
      imageRef.current,
      cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height,
      0, 0, cropRegion.width, cropRegion.height
    );
    
    updateImageFromCanvas(canvas);
    setMode('view');
    setCropRegion(null);
  };

  const applyResize = () => {
    if (!imageRef.current || !resizeDims) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = resizeDims.width;
    canvas.height = resizeDims.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(
      imageRef.current,
      0, 0, imageRef.current.naturalWidth, imageRef.current.naturalHeight,
      0, 0, resizeDims.width, resizeDims.height
    );
    
    updateImageFromCanvas(canvas);
    setMode('view');
    setResizeDims(null);
  };

  const updateImageFromCanvas = (canvas: HTMLCanvasElement) => {
    const newData = canvas.toDataURL(`image/${getFileExtension(filePath)}`);
    setImgData(newData);
  };

  const handleSave = () => {
    if (!imgData) return;
    // Extract base64 data
    const base64 = imgData.split(',')[1];
    wsService.saveFile(filePath, base64, 'base64');
  };
  
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e] text-zinc-500">
        <Loader2 className="animate-spin mr-2" /> Loading image...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0e0e0e] text-red-400">
        <X className="mr-2" /> {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0e0e] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom Out">
            <ZoomOut size={16} />
          </Button>
          <span className="text-xs w-12 text-center text-zinc-400">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom In">
            <ZoomIn size={16} />
          </Button>
        </div>
        
        <div className="w-px h-4 bg-zinc-700 mx-2" />
        
        <Button variant="ghost" size="icon" onClick={handleRotate} title="Rotate 90°">
          <RotateCw size={16} />
        </Button>
        
        <div className="w-px h-4 bg-zinc-700 mx-2" />
        
        <Button 
          variant={mode === 'crop' ? 'default' : 'ghost'} 
          size="icon" 
          onClick={handleCropStart} 
          title="Crop"
        >
          <Crop size={16} />
        </Button>
        
        <Button 
          variant={mode === 'resize' ? 'default' : 'ghost'} 
          size="icon" 
          onClick={handleResizeStart} 
          title="Resize"
        >
          <Maximize size={16} />
        </Button>
        
        <div className="flex-1" />
        
        <Button variant="default" size="sm" onClick={handleSave} className="gap-2">
          <Save size={14} /> Save
        </Button>
      </div>
      
      {/* Editor Area */}
      <div className="flex-1 relative overflow-auto flex items-center justify-center p-8 bg-[#111]">
        {mode === 'crop' && (
           <div className="absolute top-4 left-4 z-20 bg-zinc-900/90 p-3 rounded-lg border border-zinc-700 shadow-xl flex flex-col gap-3">
             <h4 className="text-xs font-medium text-zinc-300">Crop Image</h4>
             <div className="grid grid-cols-2 gap-2">
               <div>
                 <Label className="text-[10px]">X</Label>
                 <Input 
                   type="number" 
                   value={Math.round(cropRegion?.x || 0)} 
                   onChange={(e) => setCropRegion(prev => prev ? {...prev, x: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
               <div>
                 <Label className="text-[10px]">Y</Label>
                 <Input 
                   type="number" 
                   value={Math.round(cropRegion?.y || 0)} 
                   onChange={(e) => setCropRegion(prev => prev ? {...prev, y: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
               <div>
                 <Label className="text-[10px]">Width</Label>
                 <Input 
                   type="number" 
                   value={Math.round(cropRegion?.width || 0)} 
                   onChange={(e) => setCropRegion(prev => prev ? {...prev, width: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
               <div>
                 <Label className="text-[10px]">Height</Label>
                 <Input 
                   type="number" 
                   value={Math.round(cropRegion?.height || 0)} 
                   onChange={(e) => setCropRegion(prev => prev ? {...prev, height: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
             </div>
             <div className="flex gap-2 mt-1">
               <Button size="sm" variant="ghost" onClick={() => setMode('view')} className="flex-1 text-xs h-7">Cancel</Button>
               <Button size="sm" variant="default" onClick={applyCrop} className="flex-1 text-xs h-7">Apply</Button>
             </div>
           </div>
        )}

        {mode === 'resize' && (
           <div className="absolute top-4 left-4 z-20 bg-zinc-900/90 p-3 rounded-lg border border-zinc-700 shadow-xl flex flex-col gap-3">
             <h4 className="text-xs font-medium text-zinc-300">Resize Image</h4>
             <div className="grid grid-cols-2 gap-2">
               <div>
                 <Label className="text-[10px]">Width</Label>
                 <Input 
                   type="number" 
                   value={Math.round(resizeDims?.width || 0)} 
                   onChange={(e) => setResizeDims(prev => prev ? {...prev, width: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
               <div>
                 <Label className="text-[10px]">Height</Label>
                 <Input 
                   type="number" 
                   value={Math.round(resizeDims?.height || 0)} 
                   onChange={(e) => setResizeDims(prev => prev ? {...prev, height: Number(e.target.value)} : null)}
                   className="h-6 text-xs"
                 />
               </div>
             </div>
             <div className="flex gap-2 mt-1">
               <Button size="sm" variant="ghost" onClick={() => setMode('view')} className="flex-1 text-xs h-7">Cancel</Button>
               <Button size="sm" variant="default" onClick={applyResize} className="flex-1 text-xs h-7">Apply</Button>
             </div>
           </div>
        )}

        <div 
          className="relative transition-all duration-200 ease-out origin-center shadow-2xl"
          style={{ 
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        >
          {imgData && (
            <img 
              ref={imageRef}
              src={imgData} 
              alt={filePath}
              className="max-w-none shadow-black/50"
              style={{
                // Prevent drag ghosting
                userSelect: 'none',
                // @ts-expect-error - WebkitUserDrag is a non-standard property
                WebkitUserDrag: 'none'
              }}
            />
          )}
          
          {/* Crop Overlay */}
          {mode === 'crop' && cropRegion && (
            <div 
              className="absolute border-2 border-white/80 bg-black/30 pointer-events-none"
              style={{
                left: cropRegion.x,
                top: cropRegion.y,
                width: cropRegion.width,
                height: cropRegion.height,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.7)'
              }}
            >
              <div className="absolute top-0 left-0 w-2 h-2 bg-white border border-black transform -translate-x-1/2 -translate-y-1/2" />
              <div className="absolute top-0 right-0 w-2 h-2 bg-white border border-black transform translate-x-1/2 -translate-y-1/2" />
              <div className="absolute bottom-0 left-0 w-2 h-2 bg-white border border-black transform -translate-x-1/2 translate-y-1/2" />
              <div className="absolute bottom-0 right-0 w-2 h-2 bg-white border border-black transform translate-x-1/2 translate-y-1/2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
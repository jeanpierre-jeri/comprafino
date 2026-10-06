"use client";

import Image from "next/image";
import { useState } from "react";

interface Props {
  src: string | null;
  name: string;
  loading?: "lazy" | "eager";
  compact?: boolean;
}

export function ProductImage({ src, name, loading, compact = false }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`product-image relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-white ${compact ? "h-28 sm:h-34" : "h-48 sm:h-64"}`}
    >
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes={compact ? "(max-width: 639px) 112px, 136px" : "(max-width: 640px) 90vw, 288px"}
          className="object-contain p-1"
          onError={() => setFailed(true)}
          loading={loading}
        />
      ) : (
        <span className="p-2 text-center text-xs text-muted-foreground">Imagen no disponible</span>
      )}
    </div>
  );
}

"use client";

import Image from "next/image";
import { useState } from "react";

interface Props {
  src: string | null;
  name: string;
  loading?: "lazy" | "eager";
  compact?: boolean;
  thumbnail?: boolean;
}

export function ProductImage({ src, name, loading, compact = false, thumbnail = false }: Props) {
  const [failed, setFailed] = useState(false);
  let dimensions = "h-48 sm:h-64";
  if (thumbnail) {
    dimensions = "h-20 sm:h-24";
  } else if (compact) {
    dimensions = "h-28 sm:h-34";
  }

  return (
    <div
      className={`product-image relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-white ${dimensions}`}
    >
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes={thumbnail ? "96px" : "(max-width: 640px) 90vw, 288px"}
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

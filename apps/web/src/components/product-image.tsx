"use client";

import Image from "next/image";
import { useState } from "react";

interface Props {
  src: string | null;
  name: string;
  loading?: "lazy" | "eager";
}

export function ProductImage({ src, name, loading }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex aspect-square w-full items-center justify-center rounded-xl bg-white p-4">
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes="(max-width: 640px) 80vw, 256px"
          className="object-contain p-4"
          onError={() => setFailed(true)}
          loading={loading}
        />
      ) : (
        <span className="p-4 text-center text-sm text-muted-foreground">Imagen no disponible</span>
      )}
    </div>
  );
}
